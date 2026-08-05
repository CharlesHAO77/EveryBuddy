/**
 * 工作空间与目录管理（见 docs/architecture.md §5.2, §7.5）。
 *
 * 职责：
 *  - 选择本地目录（Electron 原生 dialog）
 *  - 创建工作空间（注册 + 确保 .everybuddy/sessions 目录）
 *  - 在 Finder/资源管理器中打开目录
 *  - 解析任务会话落盘目录（临时任务 -> ~/EveryBuddy/sessions/<datetime>；空间任务 -> <workspace>/.everybuddy/sessions）
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { TaskMeta, TaskType, Workspace } from "@everybuddy/ipc-contract";
import { type BrowserWindow, dialog, shell } from "electron";
import { APP_ROOT, configStore, SESSIONS_DIR } from "./configStore";

/** 格式化日期时间为目录名：2026-08-05_143020-a1b2 */
function datetimeDir(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const short = randomUUID().slice(0, 4);
  return `${stamp}-${short}`;
}

/** 弹出原生目录选择器，返回所选目录路径或 null */
export async function selectDirectory(parent?: BrowserWindow | null): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ["openDirectory", "createDirectory"],
  };
  const result =
    parent && !parent.isDestroyed()
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

/** 创建工作空间：注册到 configStore 并确保会话目录存在 */
export function createWorkspace(name: string, dirPath: string): Workspace {
  const sessionsDir = path.join(dirPath, ".everybuddy", "sessions");
  if (!existsSync(sessionsDir)) mkdirSync(sessionsDir, { recursive: true });
  return configStore.addWorkspace(name, dirPath);
}

/** 在系统文件管理器中打开目录 */
export async function openInFinder(dirPath: string): Promise<void> {
  // 确保目录存在后再打开
  if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  const err = await shell.openPath(dirPath);
  if (err) console.error(`[workspaceManager] openPath 失败: ${err}`);
}

/**
 * 为新任务解析会话落盘目录。
 *  - temp：~/EveryBuddy/sessions/<datetime>-<short>/，cwd 也设为该目录
 *  - workspace：<workspacePath>/.everybuddy/sessions/<short>/，cwd = workspacePath
 */
export function resolveSessionLocation(
  type: TaskType,
  workspace?: Workspace,
): { sessionDir: string; cwd: string } {
  if (type === "workspace" && workspace) {
    const sessionDir = path.join(
      workspace.path,
      ".everybuddy",
      "sessions",
      randomUUID().slice(0, 8),
    );
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
    return { sessionDir, cwd: workspace.path };
  }
  // 临时任务
  const sessionDir = path.join(SESSIONS_DIR, datetimeDir());
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  return { sessionDir, cwd: sessionDir };
}

/** 获取任务的工作目录（用于 agent cwd） */
export function getTaskCwd(task: TaskMeta): string {
  return task.workspacePath ?? task.sessionDir;
}

export { APP_ROOT };
