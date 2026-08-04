import { BrowserWindow, app } from "electron";
import { createMainWindow } from "./windowManager";

/**
 * 应用生命周期（见 docs/architecture.md §5.2）。
 */
app.whenReady().then(() => {
  createMainWindow();

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
