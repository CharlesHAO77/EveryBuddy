/**
 * IPC channel 注册、Zod 校验、错误统一处理（见 docs/architecture.md §5.2, §6, §7.2）。
 *
 * 命名空间：agent:* / task:* / workspace:* / config:*
 * 所有入参经 Zod schema 校验；主进程不信任渲染进程任何输入。
 */

import { randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { TaskMeta } from "@everybuddy/ipc-contract";
import {
  abortRequestSchema,
  approveToolRequestSchema,
  branchRequestSchema,
  connectorCreateRequestSchema,
  connectorIdRequestSchema,
  connectorTestRequestSchema,
  connectorUpdateRequestSchema,
  createNamedWorkspaceRequestSchema,
  createScheduleTaskRequestSchema,
  createTaskRequestSchema,
  createWorkspaceRequestSchema,
  expertCreateRequestSchema,
  expertIdRequestSchema,
  expertUpdateRequestSchema,
  extensionCommandRequestSchema,
  idRequestSchema,
  openExternalRequestSchema,
  openPathRequestSchema,
  promptRequestSchema,
  readDirRequestSchema,
  renameTaskRequestSchema,
  saveModelRequestSchema,
  scheduleIdRequestSchema,
  setApiKeyRequestSchema,
  setModeRequestSchema,
  setTaskProviderRequestSchema,
  skillCreateRequestSchema,
  skillEnableRequestSchema,
  skillIdRequestSchema,
  skillInstallRequestSchema,
  skillUpdateRequestSchema,
  teamCreateRequestSchema,
  teamIdRequestSchema,
  teamUpdateRequestSchema,
  updateScheduleTaskRequestSchema,
} from "@everybuddy/ipc-contract";
import { type BrowserWindow, ipcMain, shell } from "electron";
import { agentRuntime } from "./agentRuntime";
import { configStore, SESSIONS_DIR, WORK_SPACES_DIR } from "./configStore";
import { connectorStore } from "./connectorStore";
import { rmIfDirectChild } from "./dirCleanup";
import { expertStore } from "./expertStore";
import * as modelStore from "./modelStore";
import { scheduler } from "./scheduler";
import { skillStore } from "./skillStore";
import { teamStore } from "./teamStore";
import {
  createNamedWorkspace,
  createWorkspace,
  getTaskCwd,
  openInFinder,
  readFileForPreview,
  resolveSessionLocation,
  revealInFolder,
  selectDirectory,
} from "./workspaceManager";

/** 校验入参，失败抛错 */
function validate<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
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

/** agent 事件广播退订（macOS 重建窗口时避免累积死监听） */
let agentEventUnsub: (() => void) | null = null;

/** 注册所有 IPC 处理器 */
export function registerIpcHandlers(mainWindow: BrowserWindow): void {
  // agent 事件广播：AgentRuntime -> 主窗口渲染进程（多订阅，退订后再订阅避免累积）
  agentEventUnsub?.();
  agentEventUnsub = agentRuntime.onEvent((event) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("agent:event", event);
    }
  });

  // 调度事件广播：Scheduler -> 主窗口渲染进程（自动化页实时刷新）
  scheduler.setEventEmitter((event) => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send("schedule:event", event);
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

  // 转向发送（/steer 与运行中「转向」）：打断当前生成并处理新消息
  ipcMain.handle("agent:steer", async (_evt, raw) => {
    const req = validate(promptRequestSchema, raw);
    await agentRuntime.steerMessage(
      req.sessionId,
      req.text,
      "steer",
      req.providerId,
      req.attachments,
    );
    return { streamId: req.sessionId };
  });

  // 排队发送（/follow-up 与运行中「排队」）：当前生成完成后自动处理
  ipcMain.handle("agent:followUp", async (_evt, raw) => {
    const req = validate(promptRequestSchema, raw);
    await agentRuntime.steerMessage(
      req.sessionId,
      req.text,
      "followUp",
      req.providerId,
      req.attachments,
    );
    return { streamId: req.sessionId };
  });

  // 清空排队（steer + followUp）-> 返回被清空内容，供单项取消后重排
  ipcMain.handle("agent:clearQueue", async (_evt, raw) => {
    const req = validate(abortRequestSchema, raw);
    return agentRuntime.clearQueue(req.streamId);
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

  // 从指定 assistant 条目分叉出新会话（渲染层 footer「分支」按钮触发）
  ipcMain.handle("task:branch", async (_evt, raw) => {
    const req = validate(branchRequestSchema, raw);
    return agentRuntime.branchTask(req.taskId, req.entryId);
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

  // 在文件管理器中显示该文件（选中高亮；已删则兜底打开父目录）
  ipcMain.handle("workspace:revealPath", async (_evt, raw) => {
    const { path: targetPath } = validate(openPathRequestSchema, raw);
    await revealInFolder(targetPath);
  });

  // 读取文件内容用于预览（主进程按扩展名分类）
  ipcMain.handle("workspace:readFile", async (_evt, raw) => {
    const { path: targetPath } = validate(openPathRequestSchema, raw);
    return readFileForPreview(targetPath);
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

  // system:* —— markdown 链接等外链打开（仅放行 http/https，防任意协议注入）
  ipcMain.handle("system:openExternal", async (_evt, raw) => {
    const { url } = validate(openExternalRequestSchema, raw);
    if (!/^https?:\/\//i.test(url)) throw new Error("仅支持 http/https 链接");
    await shell.openExternal(url);
  });

  // ── schedule:*（自动化 / 定时任务） ─────────
  ipcMain.handle("schedule:list-tasks", () => scheduler.listTasks());

  ipcMain.handle("schedule:create-task", async (_evt, raw) => {
    const req = validate(createScheduleTaskRequestSchema, raw);
    return scheduler.createTask(req);
  });

  ipcMain.handle("schedule:update-task", async (_evt, raw) => {
    const req = validate(updateScheduleTaskRequestSchema, raw);
    return scheduler.updateTask(req.id, req);
  });

  ipcMain.handle("schedule:delete-task", async (_evt, raw) => {
    const { id } = validate(scheduleIdRequestSchema, raw);
    await scheduler.deleteTask(id);
  });

  ipcMain.handle("schedule:run-now", async (_evt, raw) => {
    const { id } = validate(scheduleIdRequestSchema, raw);
    await scheduler.runNow(id);
  });

  ipcMain.handle("schedule:list-runs", (_evt, raw) => {
    const { id } = validate(scheduleIdRequestSchema, raw);
    return scheduler.listRuns(id);
  });

  // ── expert:*（专家） ─────────────────────────
  ipcMain.handle("expert:list", () => expertStore.list());

  ipcMain.handle("expert:create", (_evt, raw) => {
    const req = validate(expertCreateRequestSchema, raw);
    return expertStore.create(req);
  });

  ipcMain.handle("expert:update", (_evt, raw) => {
    const req = validate(expertUpdateRequestSchema, raw);
    const updated = expertStore.update(req);
    if (!updated) throw new Error("专家不存在");
    return updated;
  });

  ipcMain.handle("expert:delete", (_evt, raw) => {
    const { id } = validate(expertIdRequestSchema, raw);
    expertStore.delete(id);
  });

  // ── team:*（专家团） ─────────────────────────
  ipcMain.handle("team:list", () => teamStore.list());

  ipcMain.handle("team:create", (_evt, raw) => {
    const req = validate(teamCreateRequestSchema, raw);
    return teamStore.create(req);
  });

  ipcMain.handle("team:update", (_evt, raw) => {
    const req = validate(teamUpdateRequestSchema, raw);
    const updated = teamStore.update(req);
    if (!updated) throw new Error("专家团不存在");
    return updated;
  });

  ipcMain.handle("team:delete", (_evt, raw) => {
    const { id } = validate(teamIdRequestSchema, raw);
    teamStore.delete(id);
  });

  // ── skill:*（技能） ─────────────────────────
  ipcMain.handle("skill:list", () => skillStore.list());

  ipcMain.handle("skill:create", (_evt, raw) => {
    const req = validate(skillCreateRequestSchema, raw);
    return skillStore.create(req);
  });

  ipcMain.handle("skill:update", (_evt, raw) => {
    const req = validate(skillUpdateRequestSchema, raw);
    const updated = skillStore.update(req);
    if (!updated) throw new Error("技能不存在");
    return updated;
  });

  ipcMain.handle("skill:install", (_evt, raw) => {
    const { sourcePath } = validate(skillInstallRequestSchema, raw);
    return skillStore.install(sourcePath);
  });

  ipcMain.handle("skill:uninstall", (_evt, raw) => {
    const { id } = validate(skillIdRequestSchema, raw);
    skillStore.uninstall(id);
  });

  ipcMain.handle("skill:enable", (_evt, raw) => {
    const req = validate(skillEnableRequestSchema, raw);
    skillStore.enable(req.id, req.enabled);
  });

  // ── connector:*（连接器） ────────────────────
  ipcMain.handle("connector:list", () => connectorStore.list());

  ipcMain.handle("connector:create", (_evt, raw) => {
    const req = validate(connectorCreateRequestSchema, raw);
    return connectorStore.create(req);
  });

  ipcMain.handle("connector:update", (_evt, raw) => {
    const req = validate(connectorUpdateRequestSchema, raw);
    const updated = connectorStore.update(req);
    if (!updated) throw new Error("连接器不存在");
    return updated;
  });

  ipcMain.handle("connector:delete", (_evt, raw) => {
    const { id } = validate(connectorIdRequestSchema, raw);
    connectorStore.delete(id);
  });

  ipcMain.handle("connector:test", (_evt, raw) => {
    const req = validate(connectorTestRequestSchema, raw);
    return connectorStore.test(req);
  });
}
