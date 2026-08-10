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
    onEvent: (cb) => {
      const handler = (_: unknown, event: unknown) => cb(event as never);
      ipcRenderer.on("agent:event", handler);
      return () => ipcRenderer.off("agent:event", handler);
    },
    extensionCommand: (req) => ipcRenderer.invoke("agent:extension-command", req),
    setMode: (req) => ipcRenderer.invoke("agent:set-mode", req),
    approveTool: (req) => ipcRenderer.invoke("agent:approveTool", req),
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
  },
  workspace: {
    list: () => ipcRenderer.invoke("workspace:list"),
    create: (name, dirPath) => ipcRenderer.invoke("workspace:create", { name, dirPath }),
    createNamed: (name) => ipcRenderer.invoke("workspace:createNamed", { name }),
    remove: (id) => ipcRenderer.invoke("workspace:remove", { id }),
    selectDir: () => ipcRenderer.invoke("workspace:selectDir"),
    openDir: (path) => ipcRenderer.invoke("workspace:openDir", { path }),
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
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
