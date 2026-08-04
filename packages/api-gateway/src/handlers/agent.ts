/**
 * agent 操作路由 handler（见 docs/architecture.md §8.1）。
 * 处理 "prompt" / "abort" 类型请求。
 */

import type { GatewayRequest, GatewayResponse } from "../types";

export async function handleAgentRequest(_req: GatewayRequest): Promise<GatewayResponse> {
  // TODO: 实现 prompt / abort 路由到 AgentRuntime
  throw new Error("handleAgentRequest not implemented");
}
