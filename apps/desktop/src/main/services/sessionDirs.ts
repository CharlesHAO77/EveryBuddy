/**
 * 任务目录解析（无 electron 依赖，供 workspaceManager 与 scheduler 共用）。
 *
 * 会话 JSONL 统一存于 ~/EveryBuddy/sessions/<datetime>-<short>；cwd 按任务类型确定：
 * 空间任务 -> workspace.path，临时任务 -> work-spaces/<datetime>-<short>（工作目录与会话目录拆分，
 * 共用同一 datetime 命名便于关联）。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { TaskType, Workspace } from "@everybuddy/ipc-contract";
import { SESSIONS_DIR, WORK_SPACES_DIR } from "../stores/configStore";

/** 格式化日期时间为目录名：2026-08-05_143020-a1b2 */
function datetimeDir(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const short = randomUUID().slice(0, 4);
  return `${stamp}-${short}`;
}

/**
 * 为新任务解析目录（创建会话目录与临时工作目录）。
 * 所有任务的会话 JSONL 统一存放在 ~/EveryBuddy/sessions/<datetime>-<short>/，与工作目录解耦。
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
