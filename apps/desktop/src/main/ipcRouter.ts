/**
 * IPC channel 注册、Zod 校验、错误统一处理（见 docs/architecture.md §5.2, §6, §7.2）。
 *
 * 命名空间：agent:* / task:* / workspace:* / config:*
 * 所有入参经 Zod schema 校验；主进程不信任渲染进程任何输入。
 */

import { randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { TaskMeta } from "@everybuddy/ipc-contract";
import {
  abortRequestSchema,
  approveToolRequestSchema,
  createNamedWorkspaceRequestSchema,
  createTaskRequestSchema,
  createWorkspaceRequestSchema,
  extensionCommandRequestSchema,
  idRequestSchema,
  openPathRequestSchema,
  promptRequestSchema,
  readDirRequestSchema,
  renameTaskRequestSchema,
  saveModelRequestSchema,
  setApiKeyRequestSchema,
  setModeRequestSchema,
  setTaskProviderRequestSchema,
} from "@everybuddy/ipc-contract";
import { type BrowserWindow, ipcMain } from "electron";
import { agentRuntime } from "./agentRuntime";
import { configStore, SESSIONS_DIR, WORK_SPACES_DIR } from "./configStore";
import * as modelStore from "./modelStore";
import {
  createNamedWorkspace,
  createWorkspace,
  getTaskCwd,
  openInFinder,
  resolveSessionLocation,
  selectDirectory,
} from "./workspaceManager";

/** 校验入参，失败抛错 */
function validate<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

/**
 * 仅当 target 是 root 的直接子目录时才递归删除，否则跳过并告警
 * （防 config.json 被篡改后误删任意目录）。
 * @param mustMatchBasename 额外要求 target 的 basename 与它一致（用于校验同 stamp 关联目录）
 */
async function rmIfDirectChild(
  target: string | undefined,
  root: string,
  label: string,
  mustMatchBasename?: string,
): Promise<void> {
  if (!target) return;
  const rel = path.relative(root, target);
  const isSafe =
    rel !== "" &&
    !rel.startsWith("..") &&
    !path.isAbsolute(rel) &&
    rel.split(path.sep).length === 1 &&
    (!mustMatchBasename || path.basename(target) === mustMatchBasename);
  if (isSafe) {
    await rm(target, { recursive: true, force: true });
  } else {
    console.warn(`[ipcRouter] 跳过非常规${label}，未删除: ${target}`);
  }
}

/**
 * 删除任务的完整链路（task:delete 与 workspace:remove 级联共用）：
 * 中止并清理会话 -> 移除元数据 -> 删除磁盘目录。
 * 会话目录删 ~/EveryBuddy/sessions 下直接子目录；临时任务额外删其工作目录
 * （work-spaces 下的同 stamp 直接子目录，且 basename 须与会话目录一致，避免误删用户命名空间）。
 */
async function deleteTaskCompletely(id: string): Promise<void> {
  const task = configStore.getTask(id); // 先取 meta，removeTask 后就拿不到了
  await agentRuntime.disposeSession(id);
  configStore.removeTask(id);
  await rmIfDirectChild(task?.sessionDir, SESSIONS_DIR, "会话目录");
  if (task?.type === "temp") {
    await rmIfDirectChild(
      task.workDir,
      WORK_SPACES_DIR,
      "临时工作目录",
      task.sessionDir ? path.basename(task.sessionDir) : undefined,
    );
  }
}

/** 注册所有 IPC 处理器 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // agent 事件广播：AgentRuntime -> 主窗口渲染进程
  agentRuntime.setEmitter((event) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("agent:event", event);
    }
  });

  // ── agent:* ───────────────────────────────
  ipcMain.handle("agent:prompt", async (_evt, raw) => {
    const req = validate(promptRequestSchema, raw);
    await agentRuntime.prompt(req.sessionId, req.text, req.providerId, req.attachments);
    return { streamId: req.sessionId };
  });

  ipcMain.handle("agent:abort", async (_evt, raw) => {
    const req = validate(abortRequestSchema, raw);
    await agentRuntime.abort(req.streamId);
  });

  // 扩展命令（如 plan-mode toggle/execute）-> 扩展控制器侧信道
  ipcMain.handle("agent:extension-command", async (_evt, raw) => {
    const req = validate(extensionCommandRequestSchema, raw);
    agentRuntime.runExtensionCommand(req.taskId, req.extension, req.command);
  });

  // 切换任务执行模式（auto/manual/plan）
  ipcMain.handle("agent:set-mode", async (_evt, raw) => {
    const req = validate(setModeRequestSchema, raw);
    agentRuntime.setTaskMode(req.taskId, req.mode);
  });

  // 应答工具权限确认 -> 恢复被暂停的工具调用
  ipcMain.handle("agent:approveTool", async (_evt, raw) => {
    const req = validate(approveToolRequestSchema, raw);
    agentRuntime.resolveToolApproval(req.taskId, req.requestId, req.approved);
  });

  // ── task:* ────────────────────────────────
  ipcMain.handle("task:list", () => configStore.listTasks());

  ipcMain.handle("task:create", async (_evt, raw) => {
    const req = validate(createTaskRequestSchema, raw);
    const workspace = req.workspaceId ? configStore.getWorkspace(req.workspaceId) : undefined;
    if (req.type === "workspace" && !workspace) {
      throw new Error("工作空间任务需要有效的 workspaceId");
    }
    const { sessionDir, workDir } = resolveSessionLocation(req.type, workspace);

    // 默认使用第一个已配置的模型
    const providerId = req.providerId ?? modelStore.getDefaultProviderId();

    const now = new Date().toISOString();
    const task: TaskMeta = {
      id: randomUUID(),
      title: req.title?.trim() || "新任务",
      type: req.type,
      mode: req.mode,
      workspaceId: workspace?.id,
      workspacePath: workspace?.path,
      workDir,
      providerId,
      sessionDir,
      createdAt: now,
      updatedAt: now,
    };
    configStore.addTask(task);

    // 创建 AgentSession（阻塞至就绪，避免与 agent:prompt 竞态；失败经事件流报错，不阻断任务创建）
    try {
      await agentRuntime.createTaskSession(task, providerId);
    } catch (err) {
      console.error(`[ipcRouter] createTaskSession 失败:`, err);
      agentRuntime.emitError(
        task.id,
        `会话初始化失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return task;
  });

  ipcMain.handle("task:delete", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    await deleteTaskCompletely(id);
  });

  ipcMain.handle("task:resume", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    const task = configStore.getTask(id);
    if (!task) throw new Error("任务不存在");
    // 已有活跃会话则跳过
    if (agentRuntime.hasSession(id)) return;
    await agentRuntime.createTaskSession(
      task,
      task.providerId ?? modelStore.getDefaultProviderId(),
    );
  });

  ipcMain.handle("task:loadHistory", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    return agentRuntime.loadHistory(id);
  });

  ipcMain.handle("task:rename", (_evt, raw) => {
    const { id, title } = validate(renameTaskRequestSchema, raw);
    configStore.updateTask(id, { title, updatedAt: new Date().toISOString() });
  });

  ipcMain.handle("task:setProvider", (_evt, raw) => {
    const req = validate(setTaskProviderRequestSchema, raw);
    configStore.updateTask(req.taskId, { providerId: req.providerId });
  });

  ipcMain.handle("task:openDir", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    const task = configStore.getTask(id);
    if (!task) throw new Error("任务不存在");
    // 打开工作目录（临时任务 -> work-spaces 下的工作目录，空间任务 -> 空间路径），而非 JSONL 会话目录
    await openInFinder(getTaskCwd(task));
  });

  // ── workspace:* ──────────────────────────
  ipcMain.handle("workspace:list", () => configStore.listWorkspaces());

  ipcMain.handle("workspace:create", (_evt, raw) => {
    const { name, dirPath } = validate(createWorkspaceRequestSchema, raw);
    return createWorkspace(name, dirPath);
  });

  ipcMain.handle("workspace:createNamed", (_evt, raw) => {
    const { name } = validate(createNamedWorkspaceRequestSchema, raw);
    return createNamedWorkspace(name);
  });

  ipcMain.handle("workspace:remove", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    // 级联删除该空间下所有任务及其会话记录（空间磁盘目录保留——
    // session 统一落在 ~/EveryBuddy/sessions，与空间目录解耦）
    const wsTasks = configStore.listTasks().filter((t) => t.workspaceId === id);
    for (const t of wsTasks) {
      try {
        await deleteTaskCompletely(t.id);
      } catch (err) {
        // 单个失败不阻断整体
        console.error(`[ipcRouter] 级联删除任务 ${t.id} 失败:`, err);
      }
    }
    configStore.removeWorkspace(id);
  });

  ipcMain.handle("workspace:selectDir", async () => {
    return selectDirectory(mainWindow);
  });

  ipcMain.handle("workspace:openDir", async (_evt, raw) => {
    const { path: targetPath } = validate(openPathRequestSchema, raw);
    await openInFinder(targetPath);
  });

  // 读取目录单层条目（懒加载目录树：文件附字节数，目录无）
  ipcMain.handle("workspace:readDir", async (_evt, raw) => {
    const { path: dir } = validate(readDirRequestSchema, raw);
    const dirents = await readdir(dir, { withFileTypes: true });
    return Promise.all(
      dirents.map(async (d) => {
        const p = path.join(dir, d.name);
        if (!d.isFile()) return { name: d.name, path: p, isDir: d.isDirectory() };
        let size: number | undefined;
        try {
          size = (await stat(p)).size;
        } catch {
          size = undefined;
        }
        return { name: d.name, path: p, isDir: false, size };
      }),
    );
  });

  // ── config:* ──────────────────────────────
  ipcMain.handle("config:getModels", () => modelStore.listProviders());

  ipcMain.handle("config:saveModel", async (_evt, raw) => {
    const req = validate(saveModelRequestSchema, raw);
    const result = modelStore.saveProvider(req);
    await agentRuntime.refreshModel();
    return result;
  });

  ipcMain.handle("config:removeModel", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    modelStore.removeProvider(id);
    await agentRuntime.refreshModel();
  });

  ipcMain.handle("config:setApiKey", async (_evt, raw) => {
    const req = validate(setApiKeyRequestSchema, raw);
    modelStore.setApiKey(req.providerId, req.apiKey);
    await agentRuntime.refreshModel();
  });

  ipcMain.handle("config:setActiveModel", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    modelStore.setActiveModel(id);
    await agentRuntime.refreshModel();
  });
}
