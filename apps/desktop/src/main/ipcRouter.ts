/**
 * IPC channel 注册、Zod 校验、错误统一处理（见 docs/architecture.md §5.2, §6, §7.2）。
 *
 * 命名空间：agent:* / task:* / workspace:* / config:*
 * 所有入参经 Zod schema 校验；主进程不信任渲染进程任何输入。
 */

import { randomUUID } from "node:crypto";
import type { CreateTaskRequest, TaskMeta } from "@everybuddy/ipc-contract";
import {
  abortRequestSchema,
  createTaskRequestSchema,
  idRequestSchema,
  promptRequestSchema,
  saveModelRequestSchema,
  setApiKeyRequestSchema,
  setTaskProviderRequestSchema,
} from "@everybuddy/ipc-contract";
import { type BrowserWindow, ipcMain } from "electron";
import { agentRuntime } from "./agentRuntime";
import { configStore } from "./configStore";
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
    const req = validate(createTaskRequestSchema, raw) as CreateTaskRequest;
    const workspace = req.workspaceId ? configStore.getWorkspace(req.workspaceId) : undefined;
    if (req.type === "workspace" && !workspace) {
      throw new Error("工作空间任务需要有效的 workspaceId");
    }
    const { sessionDir } = resolveSessionLocation(req.type, workspace);

    // 默认使用第一个已配置的模型
    const models = configStore.getModels();
    const defaultProvider = models[0]?.id;
    const providerId = req.providerId ?? defaultProvider;

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

  ipcMain.handle("task:delete", (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    agentRuntime.disposeSession(id);
    configStore.removeTask(id);
  });

  ipcMain.handle("task:resume", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    const task = configStore.getTask(id);
    if (!task) throw new Error("任务不存在");
    // 已有活跃会话则跳过
    if (agentRuntime.hasSession(id)) return;
    const models = configStore.getModels();
    const defaultProvider = models[0]?.id;
    await agentRuntime.createTaskSession(task, task.providerId ?? defaultProvider);
  });

  ipcMain.handle("task:loadHistory", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    return agentRuntime.loadHistory(id);
  });

  ipcMain.handle("task:rename", (_evt, raw) => {
    const parsed = raw as { id?: string; title?: string };
    if (!parsed.id || !parsed.title) throw new Error("参数缺失");
    configStore.updateTask(parsed.id, { title: parsed.title, updatedAt: new Date().toISOString() });
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
    const parsed = raw as { name?: string; dirPath?: string };
    if (!parsed.name || !parsed.dirPath) throw new Error("参数缺失");
    return createWorkspace(parsed.name, parsed.dirPath);
  });

  ipcMain.handle("workspace:createNamed", (_evt, raw) => {
    const parsed = raw as { name?: string };
    if (!parsed.name) throw new Error("参数缺失");
    return createNamedWorkspace(parsed.name);
  });

  ipcMain.handle("workspace:remove", (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    configStore.removeWorkspace(id);
  });

  ipcMain.handle("workspace:selectDir", async () => {
    return selectDirectory(mainWindow);
  });

  ipcMain.handle("workspace:openDir", async (_evt, raw) => {
    const parsed = raw as { path?: string };
    if (!parsed.path) throw new Error("参数缺失");
    await openInFinder(parsed.path);
  });

  // ── config:* ──────────────────────────────
  ipcMain.handle("config:getModels", () => configStore.getModels());

  ipcMain.handle("config:saveModel", async (_evt, raw) => {
    const req = validate(saveModelRequestSchema, raw);
    const result = configStore.saveModel(req);
    await agentRuntime.refreshModel(req.id);
    return result;
  });

  ipcMain.handle("config:removeModel", async (_evt, raw) => {
    const { id } = validate(idRequestSchema, raw);
    configStore.removeModel(id);
    await agentRuntime.refreshModel(id);
  });

  ipcMain.handle("config:setApiKey", async (_evt, raw) => {
    const req = validate(setApiKeyRequestSchema, raw);
    configStore.setApiKey(req.providerId, req.apiKey);
    await agentRuntime.refreshModel(req.providerId, req.apiKey);
  });
}
