import { app, BrowserWindow } from "electron";
import { agentRuntime } from "./agentRuntime";
import { ensureAppDirs } from "./configStore";
import { registerIpcHandlers } from "./ipcRouter";
import { createMainWindow } from "./windowManager";

/**
 * 应用生命周期（见 docs/architecture.md §5.2）。
 */
app.whenReady().then(async () => {
  // 确保应用目录结构存在
  ensureAppDirs();

  const mainWindow = createMainWindow();

  // 初始化 AgentRuntime（加载 pi-coding-agent、ModelRuntime）
  agentRuntime.init().catch((err) => console.error("[app] AgentRuntime 初始化失败:", err));

  // 注册 IPC 处理器
  registerIpcHandlers(mainWindow);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
