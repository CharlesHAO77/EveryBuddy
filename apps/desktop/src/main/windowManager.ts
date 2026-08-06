import path from "node:path";
import { BrowserWindow } from "electron";

/**
 * Electron Forge Vite plugin 在构建主进程时会通过 vite:define 注入
 * MAIN_WINDOW_VITE_DEV_SERVER_URL 常量（renderer name 为 main_window）。
 */
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;

/**
 * 创建主窗口（见 docs/architecture.md §5.2）。
 */
export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: "EveryBuddy",
    // 暖纸感底色，避免启动时白屏闪烁；配色与 renderer globals.css --paper 保持一致
    backgroundColor: "#faf8f4",
    // macOS 沉浸式标题栏：红绿灯嵌入侧边栏顶栏（Windows/Linux 保持默认标题栏）
    ...(process.platform === "darwin" ? { titleBarStyle: "hiddenInset" as const } : {}),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  }

  return win;
}
