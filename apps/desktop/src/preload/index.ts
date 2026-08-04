/**
 * Preload - 通过 contextBridge 暴露最小 API（见 docs/architecture.md §6.3, §7.1）。
 *
 * 安全关键：
 *  - contextIsolation: true
 *  - 仅暴露最小必要 API（ElectronAPI）
 *  - 无 setApiKey -- API Key 通过主进程原生 dialog 输入
 */
import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "@everybuddy/ipc-contract";

/**
 * 当前为 UI 开发阶段的最小 stub。
 * TODO: 接入 ipcRouter 后替换为真实 invoke/on 调用。
 */
const api: ElectronAPI = {
  agent: {
    prompt: async () => ({ streamId: "" }),
    abort: async () => undefined,
    onEvent: () => {
      // TODO: ipcRenderer.on("agent:event", cb)
      return () => undefined;
    },
  },
  session: {
    list: async () => [],
    load: async () => ({ id: "" }),
    save: async () => undefined,
  },
  config: {
    getModelConfig: async () => ({ provider: "", model: "" }),
    openApiKeyDialog: async () => undefined,
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);

// 也提供 ipcRenderer 底层通道给未来使用（暂不暴露）
void ipcRenderer;
