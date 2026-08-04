/**
 * @everybuddy/api-gateway 入口。
 * API Gateway 抽象层：桌面端内部函数路由 + 未来 IM Bot 接入点。
 *
 * @see docs/architecture.md §8
 */

export { Gateway } from "./gateway";
export type { AgentRuntimePort } from "./gateway";
export type { GatewayRequest, GatewayResponse, GatewayRequestType } from "./types";
export { handleAgentRequest } from "./handlers/agent";
export { handleSessionRequest } from "./handlers/session";
export { handleConfigRequest } from "./handlers/config";
