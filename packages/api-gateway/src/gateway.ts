/**
 * Gateway - API Gateway 抽象层核心类。
 *
 * 将统一 GatewayRequest 路由到对应 handler / AgentRuntime
 * （见 docs/architecture.md §8.1）。
 *
 * 本地模式（桌面端）：主进程内部直接调用，无网络开销。
 * 未来 IM Bot 通过 HTTP/WebSocket 连接到同一 Gateway。
 */

import type { GatewayRequest, GatewayResponse } from "./types";

/**
 * AgentRuntime 对外暴露的方法契约（端口接口）。
 * 用接口而非直接依赖 desktop 包，保持包边界清晰（见 agents.md §4）。
 */
export interface AgentRuntimePort {
  // TODO: 定义 AgentRuntime 需暴露给 Gateway 的方法
  //   prompt / abort / listSessions / loadSession / saveSession
}

export class Gateway {
  // TODO: 注入 AgentRuntimePort 与各 handler

  constructor(_runtime?: AgentRuntimePort) {}

  async handle(_request: GatewayRequest): Promise<GatewayResponse> {
    // TODO: 按 request.type 路由到对应 handler（见 handlers/*）
    throw new Error("Gateway.handle not implemented");
  }
}
