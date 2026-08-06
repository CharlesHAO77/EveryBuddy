/**
 * 工作空间与目录管理（见 docs/architecture.md §5.2, §7.5）。
 *
 * 职责：
 *  - 选择本地目录（Electron 原生 dialog）
 *  - 创建工作空间（仅注册元数据；会话统一存于 ~/EveryBuddy/sessions，不在工作空间内落盘）
 *  - 在 Finder/资源管理器中打开目录
 *  - 解析任务会话落盘目录（所有任务 -> ~/EveryBuddy/sessions/<datetime>-<short>；cwd 按任务类型：空间任务 -> workspacePath，临时任务 -> sessionDir）
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { TaskMeta, TaskType, Workspace } from "@everybuddy/ipc-contract";
import { type BrowserWindow, dialog, shell } from "electron";
import { APP_ROOT, configStore, SESSIONS_DIR, WORK_SPACES_DIR } from "./configStore";

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

/** 创建工作空间：仅注册到 configStore（会话统一存于 ~/EveryBuddy/sessions，不在工作空间内落盘） */
export function createWorkspace(name: string, dirPath: string): Workspace {
  return configStore.addWorkspace(name, dirPath);
}

/**
 * 按名称创建工作空间（不选目录）。
 * 默认落盘到 ~/EveryBuddy/work-spaces/<name>，并确保该目录存在。
 * 同名目录已存在时追加短随机后缀以避免冲突。
 */
export function createNamedWorkspace(name: string): Workspace {
  if (!existsSync(WORK_SPACES_DIR)) mkdirSync(WORK_SPACES_DIR, { recursive: true });
  const trimmed = name.trim() || "新空间";
  let dirPath = path.join(WORK_SPACES_DIR, trimmed);
  if (existsSync(dirPath)) {
    dirPath = path.join(WORK_SPACES_DIR, `${trimmed}-${randomUUID().slice(0, 4)}`);
  }
  mkdirSync(dirPath, { recursive: true });
  return createWorkspace(trimmed, dirPath);
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
 * 所有任务的会话统一存放在 ~/EveryBuddy/sessions/<datetime>-<short>/，与工作空间路径解耦；
 * cwd 仍按任务类型确定：空间任务 -> workspacePath（agent 在工作空间内操作），
 * 临时任务 -> sessionDir（以会话目录为工作目录）。
 */
export function resolveSessionLocation(
  type: TaskType,
  workspace?: Workspace,
): { sessionDir: string; cwd: string } {
  const sessionDir = path.join(SESSIONS_DIR, datetimeDir());
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  const cwd = type === "workspace" && workspace ? workspace.path : sessionDir;
  return { sessionDir, cwd };
}

/** 获取任务的工作目录（用于 agent cwd） */
export function getTaskCwd(task: TaskMeta): string {
  return task.workspacePath ?? task.sessionDir;
}

export { APP_ROOT };
