/**
 * grepTool - 纯 Node 实现的 grep 工具（rg 缺失时的降级后端）。
 *
 * SDK 内置 grep 硬依赖外部 ripgrep（rg）二进制（首次使用从 GitHub 自动下载，
 * 见 node_modules/.../dist/core/tools/grep.js ensureTool("rg")）。本文件提供
 * 一个不依赖外部二进制的等价实现：tinyglobby 枚举文件 + Node 逐行正则匹配。
 * 通过 customTools 同名 "grep" 覆盖内置（agent-session.js 注册表按名覆盖）。
 *
 * 注意：主进程为 CJS、SDK 为 ESM，此处不静态 import SDK 运行时（仅 type-only），
 * typebox 沿用 agentRuntime 的 await import("typebox") 模式。
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { glob } from "tinyglobby";

/** 与内置 grep 对齐的参数形状 */
export interface GrepParams {
  pattern: string;
  /** 目录或文件；缺省当前工作目录 */
  path?: string;
  /** 按 glob 过滤文件，如 '*.ts' */
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

/** 搜索返回体（对齐 AgentToolResult 的 content/details 形状） */
export interface GrepResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

/** 转义正则特殊字符（literal 模式） */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 读取文本行；二进制（含 NUL 字节）或不可读文件返回 null */
async function readTextLines(filePath: string): Promise<string[] | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    if (content.includes("\0")) return null;
    return content.split(/\r?\n/);
  } catch {
    return null;
  }
}

/** 纯 Node 搜索算法（可单测）：枚举文件 + 逐行匹配 + context + 格式化 */
export async function runGrepSearch(cwd: string, params: GrepParams): Promise<GrepResult> {
  const pattern = params.pattern ?? "";
  if (!pattern.trim()) {
    return { content: [{ type: "text", text: "No pattern provided" }], details: {} };
  }

  let re: RegExp;
  try {
    re = new RegExp(params.literal ? escapeRegExp(pattern) : pattern, params.ignoreCase ? "i" : "");
  } catch {
    return { content: [{ type: "text", text: `Invalid regex: ${pattern}` }], details: {} };
  }

  const limit = Math.max(1, params.limit ?? 100);
  const context = Math.max(0, params.context ?? 0);
  const searchRoot = params.path ? path.resolve(cwd, params.path) : cwd;

  // 解析文件集：path 指向文件则只搜该文件，否则按目录 glob
  let files: string[];
  let singleFile = false;
  try {
    const st = await stat(searchRoot);
    if (st.isFile()) {
      files = [searchRoot];
      singleFile = true;
    } else {
      files = await glob(params.glob ?? "**/*", {
        cwd: searchRoot,
        ignore: ["**/node_modules/**", "**/.git/**"],
        dot: true,
        onlyFiles: true,
        absolute: true,
      });
    }
  } catch {
    return { content: [{ type: "text", text: `Path not found: ${searchRoot}` }], details: {} };
  }

  const toPosix = (p: string): string => p.split(path.sep).join("/");
  const output: string[] = [];

  for (const file of files) {
    if (output.length >= limit) break;
    const lines = await readTextLines(file);
    if (!lines) continue;
    // 单文件模式显示文件名；目录模式相对搜索根
    const displayPath = singleFile
      ? path.basename(searchRoot)
      : toPosix(path.relative(searchRoot, file) || path.basename(file));

    for (const [i, line] of lines.entries()) {
      if (output.length >= limit) break;
      if (!re.test(line)) continue;
      const start = Math.max(0, i - context);
      const end = Math.min(lines.length - 1, i + context);
      for (let j = start; j <= end && output.length < limit; j++) {
        // 匹配行用 ":"，上下文行用 "-"，与常见 grep 展示一致
        const sep = j === i ? ":" : "-";
        output.push(`${displayPath}${sep}${j + 1}${sep}${lines[j] ?? ""}`);
      }
    }
  }

  const text = output.length > 0 ? output.join("\n") : "No matches found";
  return { content: [{ type: "text", text }], details: {} };
}

/** grep 兜底工具定义（名字 "grep"，schema 对齐内置 grep 工具） */
export async function createGrepToolDefinition(cwd: string): Promise<ToolDefinition> {
  const { Type } = await import("typebox");
  return {
    name: "grep",
    label: "grep",
    description:
      "Search file contents for a pattern（内置 Node 实现）。返回匹配行（文件:行号:内容），支持 glob 过滤、大小写、字面量、上下文。",
    parameters: Type.Object({
      pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
      path: Type.Optional(
        Type.String({ description: "Directory or file to search (default: current directory)" }),
      ),
      glob: Type.Optional(
        Type.String({ description: "Filter files by glob pattern, e.g. '*.ts'" }),
      ),
      ignoreCase: Type.Optional(
        Type.Boolean({ description: "Case-insensitive search (default: false)" }),
      ),
      literal: Type.Optional(
        Type.Boolean({
          description: "Treat pattern as literal string instead of regex (default: false)",
        }),
      ),
      context: Type.Optional(
        Type.Number({ description: "Lines of context before and after each match (default: 0)" }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
      ),
    }),
    execute: (_toolCallId, params) => runGrepSearch(cwd, params as GrepParams),
  };
}
