import { BrowserWindow } from "electron";
import path from "node:path";

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
