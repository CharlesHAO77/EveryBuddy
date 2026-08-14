import path from "node:path";
import { app, BrowserWindow, Menu, Notification } from "electron";
import { agentRuntime } from "./agentRuntime";
import { ensureAppDirs } from "./configStore";
import { registerIpcHandlers } from "./ipcRouter";
import { closeAllMcpClients } from "./mcpTools";
import { migrateFromLegacyConfig } from "./modelStore";
import { scheduler } from "./scheduler";
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

  // Windows 任务栏分组：Squirrel 安装版快捷方式的 AppUserModelID 为
  // com.squirrel.<包名>.<exe名>（本例 com.squirrel.EveryBuddy.EveryBuddy）。运行进程必须
  // 调用 setAppUserModelId 对齐，否则 Windows 把运行窗口与快捷方式视为两个应用——
  // 任务栏出现两个图标，系统通知也会失效。须在窗口创建前调用。
  if (process.platform === "win32") {
    app.setAppUserModelId("com.squirrel.EveryBuddy.EveryBuddy");
  }

  // 开发模式 macOS Dock 图标（打包版由 icns 自动生效，无需手动设置）
  if (process.platform === "darwin" && !app.isPackaged) {
    app.dock?.setIcon(path.join(app.getAppPath(), "assets", "icons", "icon.png"));
  }

  // 确保应用目录结构存在
  ensureAppDirs();

  // 迁移旧版 config.json 的 models[]（含明文 apiKey）到 models.json + auth.json（幂等，见 §7.3）
  migrateFromLegacyConfig();

  const mainWindow = createMainWindow();

  // 初始化 AgentRuntime（加载 pi-coding-agent、ModelRuntime）
  agentRuntime
    .init()
    .then(() => {
      // 注入调度引擎的运行时与平台能力，随后启动定时器（避免首次触发撞上未就绪 runtime）
      scheduler.wire({
        runtime: agentRuntime,
        notify: (title, body) => {
          if (Notification.isSupported()) {
            new Notification({ title, body }).show();
          }
        },
        isWindowFocused: () =>
          BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused()),
      });
      return scheduler.init();
    })
    .catch((err) => console.error("[app] AgentRuntime/Scheduler 初始化失败:", err));

  // 注册 IPC 处理器
  registerIpcHandlers(mainWindow);

  // 退出前清定时器 + 在途 run 标记取消（同步落盘）+ 关闭 MCP server 进程
  app.on("before-quit", () => {
    scheduler.stop();
    closeAllMcpClients();
  });

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
