/**
 * fileMentions - @ 文件识别纯函数（无 React 依赖，可单测）。
 *
 * parseFileMentions(text, files)：匹配 `@token`，仅剥离能解析为现有「文件」的 token →
 * AttachmentRef[]（未命中的保留字面，如 @不存在）；按 path 去重。
 * token 匹配规则：等于文件的 name，或以 `/token` 结尾（相对路径），或等于 path（绝对路径）。
 */

import type { AttachmentRef } from "@everybuddy/ipc-contract";

/** 参与匹配的文件条目（最小面；来自 workspace.readDir 或纯函数测试） */
export interface MentionFile {
  path: string;
  name: string;
  size?: number;
}

/** 匹配 `@token`：token 不含空白与 @，。！？ */
export const MENTION_TOKEN_RE = /@([^\s@，。！？]+)/g;

/** 判断 token 是否命中某文件（name 精确 / 相对路径后缀 / 绝对路径相等） */
export function tokenMatchesFile(token: string, file: MentionFile): boolean {
  if (token === file.name) return true;
  if (token === file.path) return true;
  // 相对路径（如 src/auth/login.ts）以 `/token` 结尾即可命中；两侧归一化正/反斜杠，兼容 Windows
  const pathNorm = file.path.replace(/\\/g, "/");
  const tokenNorm = token.replace(/\\/g, "/");
  return pathNorm.endsWith(`/${tokenNorm}`);
}

/** 按 path 去重，保留首个出现顺序 */
function dedupeByPath(items: AttachmentRef[]): AttachmentRef[] {
  const seen = new Set<string>();
  return items.filter((a) => {
    if (seen.has(a.path)) return false;
    seen.add(a.path);
    return true;
  });
}

export interface ParseFileMentionsResult {
  /** 剥离掉已命中文件的 @token 后的文本 */
  clean: string;
  /** 命中的附件（name/path/size；mimeType 留空，stageAttachments 按文件名派生类型） */
  attachments: AttachmentRef[];
}

export function parseFileMentions(text: string, files: MentionFile[]): ParseFileMentionsResult {
  const attachments: AttachmentRef[] = [];
  const clean = text.replace(MENTION_TOKEN_RE, (full, token: string) => {
    const hit = files.find((f) => tokenMatchesFile(token, f));
    if (hit) {
      attachments.push({
        name: hit.name,
        path: hit.path,
        size: hit.size ?? 0,
      });
      return "";
    }
    return full; // 未命中：保留字面（如 @不存在、@目录）
  });
  return { clean, attachments: dedupeByPath(attachments) };
}
