/**
 * toolAllowlist - Agent 会话工具 allowlist 构建。
 *
 * SDK（@earendil-works/pi-coding-agent）会用 createAgentSession 的 tools allowlist
 * 过滤所有工具（含 customTools，见 agent-session._refreshToolRegistry）：不在列表里的
 * 自定义工具注册了也不会暴露给模型。视觉理解/生图工具恒注册，必须始终并入 allowlist。
 */

/** 恒注册的自定义工具：注册与 allowlist 必须同步，缺失即被 SDK 静默过滤 */
export const CUSTOM_TOOL_NAMES = ["understand_image", "generate_image"] as const;

/** 平台工具 + agent 配置 tools + 恒注册自定义工具，取并集（去重保序） */
export function buildToolAllowlist(
  platformTools: readonly string[],
  cfgTools: readonly string[] | undefined,
): string[] {
  return mergeToolAllowlist(platformTools, [...(cfgTools ?? []), ...CUSTOM_TOOL_NAMES]);
}

/** 去重保序合并（与 agentRuntime 原 mergeToolAllowlist 语义一致） */
function mergeToolAllowlist(base: readonly string[], extra: string[]): string[] {
  return Array.from(new Set([...base, ...extra]));
}
