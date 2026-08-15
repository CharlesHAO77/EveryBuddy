/**
 * Preload - 通过 contextBridge 暴露最小 API（见 docs/architecture.md §6.3, §7.1）。
 *
 * 安全关键：
 *  - contextIsolation: true
 *  - 仅暴露最小必要 API（ElectronAPI）
 *  - API Key 只写不读（setApiKey），不回传明文
 */

import type { ElectronAPI } from "@everybuddy/ipc-contract";
import { contextBridge, ipcRenderer, webUtils } from "electron";

const api: ElectronAPI = {
  agent: {
    prompt: (req) => ipcRenderer.invoke("agent:prompt", req),
    abort: (streamId) => ipcRenderer.invoke("agent:abort", { streamId }),
    steer: (req) => ipcRenderer.invoke("agent:steer", req),
    followUp: (req) => ipcRenderer.invoke("agent:followUp", req),
    clearQueue: (streamId) => ipcRenderer.invoke("agent:clearQueue", { streamId }),
    onEvent: (cb) => {
      const handler = (_: unknown, event: unknown) => cb(event as never);
      ipcRenderer.on("agent:event", handler);
      return () => ipcRenderer.off("agent:event", handler);
    },
    extensionCommand: (req) => ipcRenderer.invoke("agent:extension-command", req),
    setMode: (req) => ipcRenderer.invoke("agent:set-mode", req),
    approveTool: (req) => ipcRenderer.invoke("agent:approveTool", req),
    runWorkflow: (req) => ipcRenderer.invoke("agent:run-workflow", req),
  },
  task: {
    list: () => ipcRenderer.invoke("task:list"),
    create: (req) => ipcRenderer.invoke("task:create", req),
    resume: (id) => ipcRenderer.invoke("task:resume", { id }),
    loadHistory: (id) => ipcRenderer.invoke("task:loadHistory", { id }),
    delete: (id) => ipcRenderer.invoke("task:delete", { id }),
    rename: (id, title) => ipcRenderer.invoke("task:rename", { id, title }),
    setProvider: (taskId, providerId) =>
      ipcRenderer.invoke("task:setProvider", { taskId, providerId }),
    openDir: (id) => ipcRenderer.invoke("task:openDir", { id }),
    branch: (req) => ipcRenderer.invoke("task:branch", req),
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    create: (name, dirPath) => ipcRenderer.invoke("workspace:create", { name, dirPath }),
    createNamed: (name) => ipcRenderer.invoke("workspace:createNamed", { name }),
    remove: (id) => ipcRenderer.invoke("workspace:remove", { id }),
    selectDir: () => ipcRenderer.invoke("workspace:selectDir"),
    openDir: (path) => ipcRenderer.invoke("workspace:openDir", { path }),
    readDir: (path) => ipcRenderer.invoke("workspace:readDir", { path }),
    revealPath: (path) => ipcRenderer.invoke("workspace:revealPath", { path }),
    readFile: (path) => ipcRenderer.invoke("workspace:readFile", { path }),
  },
  config: {
    getModels: () => ipcRenderer.invoke("config:getModels"),
    saveModel: (req) => ipcRenderer.invoke("config:saveModel", req),
    removeModel: (id) => ipcRenderer.invoke("config:removeModel", { id }),
    setApiKey: (req) => ipcRenderer.invoke("config:setApiKey", req),
    setActiveModel: (id) => ipcRenderer.invoke("config:setActiveModel", { id }),
  },
  system: {
    // 仅在 preload（拥有 node/electron 环境）中可调；contextBridge 支持 File 对象跨桥传递
    getPathForFile: (file) => webUtils.getPathForFile(file),
    // 用系统默认浏览器打开外链（markdown 链接用；主进程仅放行 http/https）
    openExternal: (url) => ipcRenderer.invoke("system:openExternal", { url }),
  },
  schedule: {
    listTasks: () => ipcRenderer.invoke("schedule:list-tasks"),
    createTask: (req) => ipcRenderer.invoke("schedule:create-task", req),
    updateTask: (req) => ipcRenderer.invoke("schedule:update-task", req),
    deleteTask: (id) => ipcRenderer.invoke("schedule:delete-task", { id }),
    runNow: (id) => ipcRenderer.invoke("schedule:run-now", { id }),
    listRuns: (taskId) => ipcRenderer.invoke("schedule:list-runs", { id: taskId }),
    onEvent: (cb) => {
      const handler = (_: unknown, event: unknown) => cb(event as never);
      ipcRenderer.on("schedule:event", handler);
      return () => ipcRenderer.off("schedule:event", handler);
    },
  },
  expert: {
    list: () => ipcRenderer.invoke("expert:list"),
    create: (req) => ipcRenderer.invoke("expert:create", req),
    update: (req) => ipcRenderer.invoke("expert:update", req),
    reset: (id) => ipcRenderer.invoke("expert:reset", { id }),
    catalog: () => ipcRenderer.invoke("expert:catalog"),
    delete: (id) => ipcRenderer.invoke("expert:delete", { id }),
  },
  team: {
    list: () => ipcRenderer.invoke("team:list"),
    create: (req) => ipcRenderer.invoke("team:create", req),
    update: (req) => ipcRenderer.invoke("team:update", req),
    delete: (id) => ipcRenderer.invoke("team:delete", { id }),
    duplicate: (id) => ipcRenderer.invoke("team:duplicate", { id }),
    getRuns: (taskId) => ipcRenderer.invoke("team:get-runs", { taskId }),
  },
  skill: {
    list: () => ipcRenderer.invoke("skill:list"),
    create: (req) => ipcRenderer.invoke("skill:create", req),
    update: (req) => ipcRenderer.invoke("skill:update", req),
    install: (req) => ipcRenderer.invoke("skill:install", req),
    uninstall: (id) => ipcRenderer.invoke("skill:uninstall", { id }),
    enable: (req) => ipcRenderer.invoke("skill:enable", req),
  },
  connector: {
    list: () => ipcRenderer.invoke("connector:list"),
    create: (req) => ipcRenderer.invoke("connector:create", req),
    update: (req) => ipcRenderer.invoke("connector:update", req),
    delete: (id) => ipcRenderer.invoke("connector:delete", { id }),
    test: (req) => ipcRenderer.invoke("connector:test", req),
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
