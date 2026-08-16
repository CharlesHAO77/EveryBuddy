/**
 * fileParser - 附件暂存与按需解析服务。
 *
 * 职责（Agent 自主解析模型，见 docs/architecture.md §0.4 扩展）：
 *  1. stageAttachments：发送时把附件复制到任务工作目录 <cwd>/uploads/（消毒+去重），
 *     原件保留在磁盘，Agent 可随时用 read / parse_attachment 工具读取。
 *  2. parseFileContent：按扩展名解析单个文件 —— 文本类返回文本、图片返回 base64 视觉
 *     内容、PDF/DOCX/XLSX/PPTX 抽取文本。供自定义工具 parse_attachment 调用。
 *  3. buildManifestText / splitFileMarkers：生成/回放用户消息中的文件清单标记
 *     （自闭合 <file name="uploads/x.pdf" size="123"/>），历史回放据此渲染附件 chips。
 *
 * 安全：单文件解析失败永不抛出；路径严格限定在 uploads 目录内（防 Agent 工具逃逸）。
 */

import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type {
  AttachmentRef,
  HistoryBlock,
  HistoryFileBlock,
  HistoryTextBlock,
} from "@everybuddy/ipc-contract";
import { uiError } from "./errors";

/** 解析结果内容块（与 pi-ai TextContent/ImageContent 形状一致） */
export type ParseContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type FileCategory = "text" | "image" | "pdf" | "docx" | "xlsx" | "pptx" | "unsupported";

export interface StagedFile {
  /** 原始文件名（展示用） */
  originalName: string;
  /** 本地原路径 */
  originalPath: string;
  /** uploads/ 内实际文件名（消毒 + 冲突去重） */
  uploadName: string;
  /** 复制后的完整路径 */
  uploadPath: string;
  category: FileCategory;
  size: number;
  /** 暂存失败原因（缺失/超大/复制失败）；成功则无 */
  error?: string;
  /** 未复制时 true */
  skipped: boolean;
}

export interface ParseOptions {
  /** 图片是否缩放至 provider 上限（默认 true；测试传 false 避免 worker/wasm） */
  resizeImages?: boolean;
  /** 文本抽取最大字符数（默认 100_000） */
  maxTextChars?: number;
  /** 单文件大小上限（默认 50MB，超出跳过暂存） */
  maxFileBytes?: number;
}

const DEFAULT_MAX_TEXT_CHARS = 100_000;
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const IMAGE_MAX_WIDTH = 2000;
const IMAGE_MAX_HEIGHT = 2000;
const IMAGE_MAX_BYTES = 4_000_000;

// ────────────────────────────────────────────────
// 类别识别
// ────────────────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
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

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const CATEGORY_BY_EXT: Record<string, FileCategory> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

export function categoryFromName(name: string): FileCategory {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "text";
  return CATEGORY_BY_EXT[ext] ?? "unsupported";
}

/** 魔数探测图片 MIME（png/jpg/gif/webp），失败返回 null */
export function detectImageMimeType(buf: Uint8Array): string | null {
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return "image/gif";
  }
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

// ────────────────────────────────────────────────
// 暂存（stageAttachments）
// ────────────────────────────────────────────────

/** 清洗文件名（仅保留字母/数字/._- 空格，杜绝路径分隔与非法字符） */
function sanitizeName(name: string): string {
  const base = path
    .basename(name)
    .replace(/[^\p{L}\p{N}._\-\s]/gu, "_")
    .trim();
  return base || "attachment";
}

/** uploads/ 下冲突时追加 -2/-3 去重 */
async function uniqueName(dir: string, name: string): Promise<string> {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  let i = 2;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${stem}-${i}${ext}`;
    i++;
  }
  return candidate;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 复制附件到 <cwd>/uploads/ 并返回暂存信息。
 * 单个文件失败（缺失/超大/复制异常）只记录 error + skipped，不影响其余文件。
 */
export async function stageAttachments(
  attachments: AttachmentRef[],
  cwd: string,
  options?: ParseOptions,
): Promise<StagedFile[]> {
  const uploadDir = path.join(cwd, "uploads");
  await mkdir(uploadDir, { recursive: true });
  const maxBytes = options?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  const results: StagedFile[] = [];
  for (const att of attachments) {
    const originalPath = att.path;
    const originalName = path.basename(att.name || originalPath) || "attachment";
    const st: StagedFile = {
      originalName,
      originalPath,
      uploadName: "",
      uploadPath: "",
      category: categoryFromName(originalName),
      size: att.size,
      skipped: true,
    };
    try {
      const info = await stat(originalPath);
      if (!info.isFile()) {
        st.error = "不是文件，已跳过";
        results.push(st);
        continue;
      }
      st.size = info.size;
      if (st.size > maxBytes) {
        st.error = `超过 ${formatFileSize(maxBytes)} 上限，已跳过`;
        results.push(st);
        continue;
      }
      const uploadName = await uniqueName(uploadDir, sanitizeName(originalName));
      const uploadPath = path.join(uploadDir, uploadName);
      await copyFile(originalPath, uploadPath);
      st.uploadName = uploadName;
      st.uploadPath = uploadPath;
      st.skipped = false;
    } catch (err) {
      st.error = err instanceof Error ? err.message : String(err);
    }
    results.push(st);
  }
  return results;
}

export interface ManifestOptions {
  /** 有图片且主模型无视觉时：替换默认图片提示行（如「图片已由视觉理解模型自动分析」） */
  imageHint?: string;
}

/**
 * 由暂存结果生成用户消息中的文件清单文本。
 * 每个附件一行自闭合 <file name="uploads/x" size="n"/> 标记（回放时拆回 chips），
 * 附带让 Agent 决定读取方式的提示。options.imageHint 可替换默认图片提示行。
 */
export function buildManifestText(staged: StagedFile[], options?: ManifestOptions): string {
  const lines: string[] = [`用户附带 ${staged.length} 个文件（已复制到工作目录 uploads/ 下）：`];
  const cats = new Set<FileCategory>();
  for (const s of staged) {
    if (s.skipped) {
      lines.push(`- ${s.originalName}（${s.error ?? "已跳过"}）`);
      continue;
    }
    lines.push(`<file name="uploads/${s.uploadName}" size="${s.size}"/>`);
    cats.add(s.category);
  }
  const hints: string[] = [];
  if (cats.has("text")) hints.push("文本文件可用 read 工具读取内容（支持 offset/limit 分页）");
  if (cats.has("image")) {
    hints.push(options?.imageHint ?? "图片文件可用 read 工具读取（会以视觉方式展示）");
  }
  const office = ["pdf", "docx", "xlsx", "pptx"].filter((c) => cats.has(c as FileCategory));
  if (office.length > 0)
    hints.push(`${office.join("/")} 等办公文档可用 parse_attachment 工具解析为文本`);
  if (hints.length > 0) lines.push(`提示：${hints.join("；")}。`);
  return lines.join("\n");
}

// ────────────────────────────────────────────────
// 按需解析（parseFileContent）
// ────────────────────────────────────────────────

/** 将路径解析并约束在 uploads 目录内，防止 Agent 传参逃逸到其它目录 */
export function resolveInUploads(uploadDir: string, fileRef: string): string | null {
  const norm = fileRef.replace(/\\/g, "/").replace(/^uploads\//, "");
  const resolved = path.resolve(uploadDir, norm);
  const rel = path.relative(uploadDir, resolved);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return resolved;
}

/**
 * 解析单个文件为文本 / 图片内容。永不抛出：任何失败返回文本错误内容。
 * @param filePath uploads 内的完整路径
 */
export async function parseFileContent(
  filePath: string,
  options?: ParseOptions,
): Promise<{ content: ParseContent[] }> {
  const maxTextChars = options?.maxTextChars ?? DEFAULT_MAX_TEXT_CHARS;
  const name = path.basename(filePath);
  const category = categoryFromName(name);

  try {
    switch (category) {
      case "image":
        return { content: [await parseImage(filePath, options?.resizeImages ?? true)] };
      case "text":
        return { content: [{ type: "text", text: await parseTextFile(filePath, maxTextChars) }] };
      case "pdf":
        return { content: [{ type: "text", text: await parsePdf(filePath, maxTextChars) }] };
      case "docx":
        return { content: [{ type: "text", text: await parseDocx(filePath, maxTextChars) }] };
      case "xlsx":
        return { content: [{ type: "text", text: await parseXlsx(filePath, maxTextChars) }] };
      case "pptx":
        return { content: [{ type: "text", text: await parsePptx(filePath, maxTextChars) }] };
      default:
        return {
          content: [
            {
              type: "text",
              text: `[无法解析该文件格式（${category}）：${name}。文件已保留在 uploads/ 下，可用 bash 等工具自行处理。]`,
            },
          ],
        };
    }
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `[解析失败: ${err instanceof Error ? err.message : String(err)}]`,
        },
      ],
    };
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[内容已截断]`;
}

/** 文本读取：首 1KB NUL 探测拒绝二进制误当文本；UTF-8 解码去 BOM */
async function parseTextFile(filePath: string, max: number): Promise<string> {
  const buf = await readFile(filePath);
  const head = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).subarray(0, 1024);
  if (head.includes(0)) {
    throw uiError("errors.binaryAsText");
  }
  let text = buf.toString("utf-8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  return truncate(text, max);
}

/** 图片：魔数探测 mime → base64 → 可选 resize（失败回退原始 base64） */
async function parseImage(filePath: string, resize: boolean): Promise<ParseContent> {
  const buf = await readFile(filePath);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const mimeType = detectImageMimeType(bytes) ?? "image/png";
  let data = buf.toString("base64");

  if (resize) {
    try {
      const sdk = await import("@earendil-works/pi-coding-agent");
      if (typeof sdk.resizeImage === "function") {
        const resized = await sdk.resizeImage(bytes, mimeType, {
          maxWidth: IMAGE_MAX_WIDTH,
          maxHeight: IMAGE_MAX_HEIGHT,
          maxBytes: IMAGE_MAX_BYTES,
        });
        if (resized) {
          data = resized.data;
          // 缩放可能把 png 转成 jpeg；保留新 mimeType
          return { type: "image", data, mimeType: resized.mimeType };
        }
      }
    } catch {
      // worker/wasm 不可用时回退原始 base64
    }
  }
  return { type: "image", data, mimeType };
}

/** PDF：unpdf（ESM，懒加载）抽取全部页合并文本 */
async function parsePdf(filePath: string, max: number): Promise<string> {
  const { extractText } = await import("unpdf");
  const buf = await readFile(filePath);
  const res = await extractText(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), {
    mergePages: true,
  });
  return truncate(res.text, max);
}

/** DOCX：mammoth 抽取纯文本 */
async function parseDocx(filePath: string, max: number): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ path: filePath });
  return truncate(value, max);
}

/** XLSX：SheetJS 逐 sheet 转 CSV */
async function parseXlsx(filePath: string, max: number): Promise<string> {
  const XLSX = await import("xlsx");
  const wb = XLSX.readFile(filePath);
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
    parts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
  }
  return truncate(parts.join("\n\n"), max);
}

/** PPTX：解压后抽每页 <a:t> 文本 */
async function parsePptx(filePath: string, max: number): Promise<string> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const slideFiles = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/)?.[1] ?? 0);
      return na - nb;
    });
  const pages: string[] = [];
  for (const f of slideFiles) {
    const entry = zip.files[f];
    if (!entry) continue;
    const xml = await entry.async("string");
    const texts = [...xml.matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)]
      .map((m) => decodeXmlEntity(m[1] ?? ""))
      .filter((t) => t.trim().length > 0);
    if (texts.length > 0)
      pages.push(`--- Slide ${f.match(/slide(\d+)/)?.[1] ?? ""} ---\n${texts.join("\n")}`);
  }
  if (pages.length === 0) throw uiError("errors.pptNoText");
  return truncate(pages.join("\n\n"), max);
}

function decodeXmlEntity(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

// ────────────────────────────────────────────────
// 清单回放（splitFileMarkers）
// ────────────────────────────────────────────────

/**
 * 将用户消息文本中的自闭合 <file name="uploads/x.pdf" size="123"/> 标记拆分为
 * HistoryFileBlock，标记外的纯文本合并为 HistoryTextBlock（历史回放渲染附件 chips）。
 * 注意：文件正文中若出现相同标记会误拆（与 SDK 的 <file> 约定一致，可接受）。
 */
export function splitFileMarkers(text: string): HistoryBlock[] {
  const blocks: HistoryBlock[] = [];
  const markerRe = /<file name="([^"]+)"(?: size="(\d+)")?\/>/g;
  let lastIndex = 0;
  let fileIndex = 0;
  let textIndex = 0;
  for (let match = markerRe.exec(text); match !== null; match = markerRe.exec(text)) {
    const plain = text.slice(lastIndex, match.index);
    if (plain.trim().length > 0) {
      const tb: HistoryTextBlock = {
        id: `t${textIndex++}`,
        kind: "text",
        content: plain.trim(),
        done: true,
      };
      blocks.push(tb);
    }
    const size = match[2] !== undefined ? Number(match[2]) : undefined;
    const fb: HistoryFileBlock = {
      id: `f${fileIndex++}`,
      kind: "file",
      name: path.basename(match[1] ?? ""),
      size: size && Number.isFinite(size) ? size : undefined,
      done: true,
    };
    blocks.push(fb);
    lastIndex = markerRe.lastIndex;
  }
  const tail = text.slice(lastIndex);
  if (tail.trim().length > 0) {
    const tb: HistoryTextBlock = {
      id: `t${textIndex}`,
      kind: "text",
      content: tail.trim(),
      done: true,
    };
    blocks.push(tb);
  }
  return blocks;
}
