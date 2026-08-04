/**
 * Preload - 通过 contextBridge 暴露最小 API（见 docs/architecture.md §6.3, §7.1）。
 *
 * 安全关键：
 *  - contextIsolation: true
 *  - 仅暴露最小必要 API（ElectronAPI）
 *  - 无 setApiKey -- API Key 通过主进程原生 dialog 输入
 */
// TODO: 实现 contextBridge.exposeInMainWorld("electronAPI", api)
// TODO: api 形状见 @everybuddy/ipc-contract 的 ElectronAPI
export {}; // 占位
