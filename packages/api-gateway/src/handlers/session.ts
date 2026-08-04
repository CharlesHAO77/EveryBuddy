/**
 * 会话操作路由 handler（见 docs/architecture.md §8.1）。
 * 处理 "list_sessions" / "load_session" / "save_session" 类型请求。
 */

import type { GatewayRequest, GatewayResponse } from "../types";

export async function handleSessionRequest(_req: GatewayRequest): Promise<GatewayResponse> {
  // TODO: 实现会话读写路由到 AgentRuntime / SessionManager
  throw new Error("handleSessionRequest not implemented");
}
