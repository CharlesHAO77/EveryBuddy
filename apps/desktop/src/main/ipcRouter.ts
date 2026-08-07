/**
 * IPC channel 注册、Zod 校验、错误统一处理（见 docs/architecture.md §5.2, §6, §7.2）。
 *
 * 命名空间：agent:* / task:* / workspace:* / config:*
 * 所有入参经 Zod schema 校验；主进程不信任渲染进程任何输入。
 */

import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { TaskMeta } from "@everybuddy/ipc-contract";
import {
  abortRequestSchema,
  createNamedWorkspaceRequestSchema,
  createTaskRequestSchema,
  createWorkspaceRequestSchema,
  idRequestSchema,
  openPathRequestSchema,
  promptRequestSchema,
  renameTaskRequestSchema,
  saveModelRequestSchema,
  setApiKeyRequestSchema,
  setTaskProviderRequestSchema,
} from "@everybuddy/ipc-contract";
import { type BrowserWindow, ipcMain } from "electron";
import { agentRuntime } from "./agentRuntime";
import { configStore, SESSIONS_DIR } from "./configStore";
import * as modelStore from "./modelStore";
import {
  createNamedWorkspace,
  createWorkspace,
  openInFinder,
  resolveSessionLocation,
  selectDirectory,
} from "./workspaceManager";

/** 校验入参，失败抛错 */
function validate<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  return schema.parse(value);
}

/**
 * 删除任务的完整链路（task:delete 与 workspace:remove 级联共用）：
 * 中止并清理会话 -> 移除元数据 -> 删除磁盘 sessionDir。
 * sessionDir 必须落在 ~/EveryBuddy/sessions 直接子目录内，否则跳过并告警
 * （防 config.json 被篡改后误删任意目录）。
 */
async function deleteTaskCompletely(id: string): Promise<void> {
  const task = configStore.getTask(id); // 先取 meta，removeTask 后就拿不到了
  await agentRuntime.disposeSession(id);
  configStore.removeTask(id);
  if (task?.sessionDir) {
    const rel = path.relative(SESSIONS_DIR, task.sessionDir);
    const isSafe =
      rel !== "" &&
      !rel.startsWith("..") &&
      !path.isAbsolute(rel) &&
      rel.split(path.sep).length === 1;
    if (isSafe) {
      await rm(task.sessionDir, { recursive: true, force: true });
    } else {
      console.warn(`[ipcRouter] 跳过非常规 sessionDir，未删除: ${task.sessionDir}`);
    }
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
    await agentRuntime.prompt(req.sessionId, req.text, req.providerId);
    return { streamId: req.sessionId };
  });

  ipcMain.handle("agent:abort", async (_evt, raw) => {
    const req = validate(abortRequestSchema, raw);
    await agentRuntime.abort(req.streamId);
  });

  // ── task:* ────────────────────────────────
  ipcMain.handle("task:list", () => configStore.listTasks());

  ipcMain.handle("task:create", async (_evt, raw) => {
    const req = validate(createTaskRequestSchema, raw);
    const workspace = req.workspaceId ? configStore.getWorkspace(req.workspaceId) : undefined;
    if (req.type === "workspace" && !workspace) {
      throw new Error("工作空间任务需要有效的 workspaceId");
    }
    const { sessionDir } = resolveSessionLocation(req.type, workspace);

    // 默认使用第一个已配置的模型
    const providerId = req.providerId ?? modelStore.getDefaultProviderId();

    const now = new Date().toISOString();
    const task: TaskMeta = {
      id: randomUUID(),
      title: req.title?.trim() || "新任务",
      type: req.type,
      workspaceId: workspace?.id,
      workspacePath: workspace?.path,
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
    await openInFinder(task.sessionDir);
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
}
