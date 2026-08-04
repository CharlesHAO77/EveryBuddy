/**
 * API Gateway 请求/响应类型（见 docs/architecture.md §8.1）。
 */

export type GatewayRequestType =
  | "prompt"
  | "abort"
  | "list_sessions"
  | "load_session"
  | "save_session";

export interface GatewayRequest {
  type: GatewayRequestType;
  payload: unknown;
  meta?: {
    /** 客户端标识："desktop" | "im-bot" | ... */
    clientId: string;
    timestamp: string;
  };
}

export interface GatewayResponse {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}
