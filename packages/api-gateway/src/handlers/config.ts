/**
 * 配置操作路由 handler（见 docs/architecture.md §8.1）。
 * 处理配置查询等非敏感操作（不传递 API Key）。
 */

import type { GatewayRequest, GatewayResponse } from "../types";

export async function handleConfigRequest(_req: GatewayRequest): Promise<GatewayResponse> {
  // TODO: 实现配置查询路由到 configStore
  throw new Error("handleConfigRequest not implemented");
}
