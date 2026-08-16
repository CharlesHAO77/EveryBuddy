/**
 * 系统提示词 builder 入口（见 docs/architecture.md §5.1）。
 *
 * 参考 pi packages/coding-agent/src/core/system-prompt.ts 的 buildSystemPrompt：
 * 按 mode 选择 builder，按当前激活工具动态拼出「可用工具」清单。
 *
 * 设计：builder 产出角色 + 工具 + 准则；cwd / AGENTS.md / skills / appendSystemPrompt
 * 由 SDK 的 customPrompt 分支继续追加，避免重复。
 */

import type { AgentMode } from "@everybuddy/ipc-contract";
import { buildCodingPrompt } from "./coding";
import { buildDailyPrompt } from "./daily";

export interface PromptCtx {
  /** 当前激活工具名（来自 createAgentSession 的 tools allowlist） */
  activeTools: readonly string[];
}

/**
 * 内置 + 自定义工具的一行说明，用于在提示词中列出「可用工具」。
 * 对齐 pi readToolSystemPromptContribution.snippet 的做法（写死常量）。
 * 新增/改名工具时需同步；工具 schema 仍由 SDK 下发，snippet 过时仅影响文本描述。
 */
export const TOOL_SNIPPETS: Record<string, string> = {
  read: "读取文件内容(文本/图片)",
  bash: "执行 shell 命令",
  edit: "精确替换编辑文件",
  write: "写入/创建文件",
  grep: "正则搜索文件内容",
  find: "按名称/模式查找文件",
  ls: "列出目录内容",
  parse_attachment: "解析 PDF/Word/Excel/PPT 等办公文档",
  understand_image: "调用视觉模型理解图片",
  generate_image: "调用生图模型生成图片",
  todo: "管理待办列表(list/add/toggle/clear)",
};

/** 按模式构建系统提示词；用户在 agent-*.json 配置 systemPrompt 时覆盖此默认 */
export function getModeSystemPrompt(mode: AgentMode, ctx: PromptCtx): string {
  return mode === "coding" ? buildCodingPrompt(ctx) : buildDailyPrompt(ctx);
}

/**
 * 按当前激活工具生成「可用工具」清单（含"未列出的一律不可用"约束）。
 * 用于自定义专家：其身份提示词不含工具清单，模型会按通用认知臆测内置 read/bash/联网等，
 * 显式清单可让模型准确自述能力。
 */
export function buildActiveToolsBlock(activeTools: readonly string[]): string {
  const lines = activeTools.map((n) => `- ${n}：${TOOL_SNIPPETS[n] ?? "自定义工具"}`).join("\n");
  return `当前可用工具（仅下列工具可调用，未列出的一律不可用）：\n${lines || "(无工具)"}`;
}
