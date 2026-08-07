/**
 * 工作空间与目录管理（见 docs/architecture.md §5.2, §7.5）。
 *
 * 职责：
 *  - 选择本地目录（Electron 原生 dialog）
 *  - 创建工作空间（仅注册元数据；会话统一存于 ~/EveryBuddy/sessions，不在工作空间内落盘）
 *  - 在 Finder/资源管理器中打开目录
 *  - 解析任务目录：会话 JSONL 统一存于 ~/EveryBuddy/sessions/<datetime>-<short>；
 *    cwd 按任务类型：空间任务 -> workspacePath，临时任务 -> work-spaces/<datetime>-<short>（工作目录与会话分离）
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
 * 为新任务解析目录。
 * 所有任务的会话 JSONL 统一存放在 ~/EveryBuddy/sessions/<datetime>-<short>/，与工作目录解耦；
 * cwd 按任务类型确定：空间任务 -> workspace.path（agent 在工作空间内操作），
 * 临时任务 -> work-spaces/<datetime>-<short>（工作目录与会话目录拆分，共用同一 datetime 命名便于关联）。
 */
export function resolveSessionLocation(
  type: TaskType,
  workspace?: Workspace,
): { sessionDir: string; cwd: string; workDir?: string } {
  const stamp = datetimeDir();
  const sessionDir = path.join(SESSIONS_DIR, stamp);
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  let cwd = sessionDir;
  let workDir: string | undefined;
  if (type === "workspace" && workspace) {
    cwd = workspace.path;
  } else {
    // 临时任务：工作目录从 sessions 拆分到 work-spaces/<stamp>
    workDir = path.join(WORK_SPACES_DIR, stamp);
    if (!existsSync(workDir)) mkdirSync(workDir, { recursive: true });
    cwd = workDir;
  }
  return { sessionDir, cwd, workDir };
}

/** 获取任务的工作目录（用于 agent cwd）。空间任务 -> workspacePath；临时任务 -> workDir */
export function getTaskCwd(task: TaskMeta): string {
  // 两者必有其一，缺失即异常（不做旧任务兜底——sessionDir 现在只存会话 JSONL，不再是 cwd）
  const cwd = task.workspacePath ?? task.workDir;
  if (!cwd) throw new Error(`任务缺少工作目录: ${task.id}`);
  return cwd;
}

export { APP_ROOT };
