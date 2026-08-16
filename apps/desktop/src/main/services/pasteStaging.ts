/**
 * pasteStaging - 粘贴的剪贴板文件暂存（system:stage-pasted-file）。
 *
 * 输入框直接粘贴图片等场景：剪贴板内存文件没有真实路径（webUtils.getPathForFile 为空），
 * 渲染进程读为 base64 后经此写入临时目录，返回可读路径，发送时由 stageAttachments 复制到
 * <cwd>/uploads/（与拖拽/选择的真实文件走同一条复制链路）。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { StagePastedFileRequest } from "@everybuddy/ipc-contract";

/** 临时暂存根目录（系统临时目录下，OS 负责清理） */
const PASTE_DIR = path.join(tmpdir(), "everybuddy-paste");

/** MIME → 扩展名（用于补齐缺失/空扩展名的文件名） */
const MIME_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "text/plain": ".txt",
  "application/pdf": ".pdf",
};

/** 清洗文件主干名（对齐 fileParser.sanitizeName：仅保留字母/数字/._- 空格） */
function sanitizeStem(name: string): string {
  const base = path.basename(name).replace(path.extname(name), "");
  const cleaned = base.replace(/[^\p{L}\p{N}._\-\s]/gu, "_").trim();
  return cleaned || "paste";
}

/**
 * 把 base64 内容写入临时文件，返回绝对路径。
 * 扩展名优先取 name 自带，否则按 MIME 推断；文件名加时间戳前缀避免与其它粘贴冲突。
 */
export function stagePastedFile(req: StagePastedFileRequest): string {
  const ext =
    (path.extname(req.name) || MIME_EXT[req.mimeType ?? ""] || ".bin").toLowerCase() || ".bin";
  const stem = sanitizeStem(req.name);
  mkdirSync(PASTE_DIR, { recursive: true });
  const filePath = path.join(PASTE_DIR, `${Date.now()}-${stem}${ext}`);
  writeFileSync(filePath, Buffer.from(req.data, "base64"));
  return filePath;
}
