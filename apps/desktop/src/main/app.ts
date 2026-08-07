import { app, BrowserWindow, Menu } from "electron";
import { agentRuntime } from "./agentRuntime";
import { ensureAppDirs } from "./configStore";
import { registerIpcHandlers } from "./ipcRouter";
import { migrateFromLegacyConfig } from "./modelStore";
import { createMainWindow } from "./windowManager";

/**
 * 应用生命周期（见 docs/architecture.md §5.2）。
 */
app.whenReady().then(async () => {
  // Windows 自定义标题栏：移除窗口内应用菜单（macOS 菜单在系统菜单栏，保持不动；Linux 保持默认）。
  // 必须在 createMainWindow 之前调用，否则窗口创建后不生效（见 electron/electron#16521）。
  if (process.platform === "win32") {
    Menu.setApplicationMenu(null);
  }

  // 确保应用目录结构存在
  ensureAppDirs();

  // 迁移旧版 config.json 的 models[]（含明文 apiKey）到 models.json + auth.json（幂等，见 §7.3）
  migrateFromLegacyConfig();

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
