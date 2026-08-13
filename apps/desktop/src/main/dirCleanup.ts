/**
 * 目录安全删除守卫（无 electron 依赖，供 ipcRouter 与 scheduler 共用）。
 *
 * 仅当 target 是 root 的直接子目录时才递归删除，否则跳过并告警
 * （防 config.json 被篡改后误删任意目录）。
 */

import { rm } from "node:fs/promises";
import path from "node:path";

/**
 * 递归删除 root 下的直接子目录；路径不符/越界时跳过。
 * @param mustMatchBasename 额外要求 target 的 basename 与它一致（用于校验同 stamp 关联目录）
 */
export async function rmIfDirectChild(
  target: string | undefined,
  root: string,
  label: string,
  mustMatchBasename?: string,
): Promise<void> {
  if (!target) return;
  const rel = path.relative(root, target);
  const isSafe =
    rel !== "" &&
    !rel.startsWith("..") &&
    !path.isAbsolute(rel) &&
    rel.split(path.sep).length === 1 &&
    (!mustMatchBasename || path.basename(target) === mustMatchBasename);
  if (isSafe) {
    await rm(target, { recursive: true, force: true });
  } else {
    console.warn(`[dirCleanup] 跳过非常规${label}，未删除: ${target}`);
  }
}
