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
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ReadFileResult, TaskMeta, Workspace } from "@everybuddy/ipc-contract";
import { type BrowserWindow, dialog, shell } from "electron";
import { APP_ROOT, configStore, WORK_SPACES_DIR } from "../stores/configStore";
import { uiError } from "./errors";
import { detectImageMimeType } from "./fileParser";

// 目录解析（datetime 命名 + 会话/工作目录拆分）迁至 sessionDirs.ts，此处重导出保持既有 import 不变
export { resolveSessionLocation } from "./sessionDirs";

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
 * 在系统文件管理器中显示该文件（选中高亮）。
 * 渲染进程可能传混合路径分隔符（如 `D:\x/generated/a.png`），先 path.resolve 归一；
 * 文件已删除/移动时兜底打开其父目录，而非静默无效。
 */
export async function revealInFolder(filePath: string): Promise<void> {
  const normalized = path.resolve(filePath);
  if (existsSync(normalized)) {
    shell.showItemInFolder(normalized);
  } else {
    console.warn(`[workspaceManager] 文件不存在，改打开父目录: ${normalized}`);
    await openInFinder(path.dirname(normalized));
  }
}

/** 获取任务的工作目录（用于 agent cwd）。空间任务 -> workspacePath；临时任务 -> workDir */
export function getTaskCwd(task: TaskMeta): string {
  // 两者必有其一，缺失即异常（不做旧任务兜底——sessionDir 现在只存会话 JSONL，不再是 cwd）
  const cwd = task.workspacePath ?? task.workDir;
  if (!cwd) throw uiError("errors.taskMissingWorkDir", { id: task.id });
  return cwd;
}

// ────────────────────────────────────────────────
// 预览读取（workspace:readFile）
// ────────────────────────────────────────────────

// 预览专用集合：与 fileParser.categoryFromName 解耦（后者把 svg 归 unsupported、缺 bmp），
// 渲染进程 PreviewView 的图片判定需与此保持一致。
const PREVIEW_IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);
const PREVIEW_TEXT_EXT = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "jsonl",
  "csv",
  "tsv",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "less",
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "cs",
  "go",
  "rs",
  "rb",
  "php",
  "sh",
  "bash",
  "zsh",
  "sql",
  "graphql",
  "proto",
  "kt",
  "kts",
  "swift",
  "r",
  "lua",
  "pl",
  "dart",
  "vue",
  "svelte",
  "dockerfile",
  "log",
]);
/** 文本预览上限：超过视为不可预览（二进制分支），避免把大文件整包拉进渲染进程 */
const PREVIEW_TEXT_CAP = 1024 * 1024;

/** svg/bmp 等 detectImageMimeType 不识别的扩展名兜底 mime */
const PREVIEW_IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

/**
 * 读取文件用于预览。永不抛出：任何失败返回 { kind: "error" }。
 * 按扩展名分类：图片 -> base64 dataUrl；文本/代码 -> UTF-8 文本（1MB 上限 + NUL 探测）；
 * 其它 -> binary。
 */
export async function readFileForPreview(filePath: string): Promise<ReadFileResult> {
  const normalized = path.resolve(filePath);
  const ext = path.extname(normalized).slice(1).toLowerCase();
  try {
    const info = await stat(normalized);
    if (!info.isFile()) return { kind: "error", error: "不是文件，无法预览" };

    if (PREVIEW_IMAGE_EXT.has(ext)) {
      const buf = await readFile(normalized);
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const mimeType = detectImageMimeType(bytes) ?? PREVIEW_IMAGE_MIME[ext] ?? "image/png";
      return {
        kind: "image",
        dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`,
        mimeType,
        size: info.size,
      };
    }

    if (PREVIEW_TEXT_EXT.has(ext)) {
      if (info.size > PREVIEW_TEXT_CAP) return { kind: "binary", size: info.size };
      const buf = await readFile(normalized);
      // 首 1KB NUL 探测拒绝二进制误当文本
      const head = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).subarray(0, 1024);
      if (head.includes(0)) return { kind: "binary", size: info.size };
      let text = buf.toString("utf-8");
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
      return { kind: "text", text, mimeType: "text/plain", size: info.size };
    }

    return { kind: "binary", size: info.size };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export { APP_ROOT };
