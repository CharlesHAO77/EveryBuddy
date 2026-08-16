/**
 * expertCatalog - 专家表单「工具/扩展」列表选择目录 + 模式默认提示词（只读，经 expert:catalog IPC 下发）。
 *
 * 平台工具取 prompts/TOOL_SNIPPETS（与主进程 allowlist 一致，已覆盖 CUSTOM_TOOL_NAMES）；
 * 扩展取 EXTENSION_CATALOG。已连接 MCP 工具与已装技能不在此处（渲染层 connectors/skills 已有）。
 * modePrompts 用全量工具集拼出各模式默认系统提示词，供内置专家详情「同步展示」。
 */

import type { AgentMode, ExpertCatalog } from "@everybuddy/ipc-contract";
import { DEFAULT_EXTENSIONS, EXTENSION_CATALOG } from "../extensions";
import { getModeSystemPrompt, TOOL_SNIPPETS } from "../prompts";

/** 默认工具集：覆盖 TOOL_SNIPPETS 全部（平台 + 自定义工具，与运行时 allowlist 主流一致） */
const DEFAULT_PREVIEW_TOOLS = Object.keys(TOOL_SNIPPETS);

export function buildExpertCatalog(): ExpertCatalog {
  const modes: AgentMode[] = ["daily", "coding"];
  return {
    tools: Object.entries(TOOL_SNIPPETS).map(([name, description]) => ({ name, description })),
    extensions: EXTENSION_CATALOG,
    modePrompts: Object.fromEntries(
      modes.map((mode) => [mode, getModeSystemPrompt(mode, { activeTools: DEFAULT_PREVIEW_TOOLS })]),
    ) as Record<AgentMode, string>,
    defaultTools: Object.fromEntries(
      modes.map((mode) => [mode, DEFAULT_PREVIEW_TOOLS]),
    ) as Record<AgentMode, string[]>,
    defaultExtensions: Object.fromEntries(
      modes.map((mode) => [mode, DEFAULT_EXTENSIONS[mode]]),
    ) as Record<AgentMode, string[]>,
  };
}
