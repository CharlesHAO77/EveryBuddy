/**
 * IPC 契约 - 渲染进程与主进程之间的类型安全通信协议。
 *
 * 命名空间（见 docs/architecture.md §6.1）：
 *  - agent:*    agent 操作触发与事件推送
 *  - session:*  会话管理
 *  - config:*   配置与凭证（不传递 API Key）
 *  - system:*   应用级事件
 *
 * 安全关键：此处不定义任何传递 API Key 的类型。
 *
 * @see docs/architecture.md §6
 */
import { z } from "zod";

// ────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────

/** 发送用户消息请求（见 §6.2 agent:prompt） */
export interface PromptRequest {
  sessionId?: string;
  text: string;
  // TODO: 补充 workspace、模型等字段
}

/** agent:prompt 返回 */
export interface PromptResponse {
  streamId: string;
}

export interface ToolCallInfo {
  toolName: string;
  args: unknown;
}

export interface ToolCallResult {
  toolName: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

/**
 * 统一事件流（见 §6.2 agent:event，§5.1 事件流）。
 * pi-coding-agent 原始事件经 AgentRuntime 转换为此类型。
 */
export type AgentEvent =
  | { streamId: string; type: "message_start"; payload: { role: "assistant" } }
  | { streamId: string; type: "message_delta"; payload: { content: string } }
  | { streamId: string; type: "message_end"; payload: { stopReason?: string } }
  | { streamId: string; type: "tool_execution_start"; payload: ToolCallInfo }
  | { streamId: string; type: "tool_execution_end"; payload: ToolCallResult }
  | { streamId: string; type: "error"; payload: { message: string } };
// TODO: 按需扩展事件类型，对齐 pi-coding-agent 原始事件

// ────────────────────────────────────────────────
// Session
// ────────────────────────────────────────────────

export interface SessionSummary {
  id: string;
  title: string;
  updatedAt: string;
  // TODO: 补充字段
}

/** 会话 JSONL tree 结构（见 §9.2） */
export interface SessionTree {
  id: string;
  // TODO: 定义 JSONL tree 节点结构（支持未来分支与回滚）
}

// ────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────

/** 模型配置（不含 API Key，见 §6.2 config:getModelConfig） */
export interface ModelConfig {
  provider: string;
  model: string;
  // TODO: 补充 temperature、maxTokens 等非敏感字段
}

// ────────────────────────────────────────────────
// System
// ────────────────────────────────────────────────

export interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
  // TODO: 补充字段
}

/** 工具确认请求（见 §6.2 system:toolConfirm，§7.4） */
export interface ToolConfirmRequest {
  toolName: string;
  args: unknown;
  impact: string;
  // TODO: 补充工作区、风险等级等字段
}

export interface ToolConfirmResponse {
  approved: boolean;
  // TODO: 补充 rememberWorkspace 选项等
}

// ────────────────────────────────────────────────
// Zod schemas（运行时校验，见 §7.2）
// ────────────────────────────────────────────────

// TODO: 为每个请求类型定义收紧的 Zod schema，并在 ipcRouter 中使用
export const promptRequestSchema = z
  .object({
    text: z.string().min(1),
    sessionId: z.string().optional(),
  })
  .passthrough();

export const abortRequestSchema = z.object({
  streamId: z.string().min(1),
});

export const loadSessionRequestSchema = z.object({
  id: z.string().min(1),
});

// ────────────────────────────────────────────────
// Preload API 形状（见 §6.3）
// ────────────────────────────────────────────────

export interface ElectronAPI {
  agent: {
    prompt: (req: PromptRequest) => Promise<PromptResponse>;
    abort: (streamId: string) => Promise<void>;
    onEvent: (cb: (event: AgentEvent) => void) => () => void;
  };
  session: {
    list: () => Promise<SessionSummary[]>;
    load: (id: string) => Promise<SessionTree>;
    save: (session: SessionTree) => Promise<void>;
  };
  config: {
    getModelConfig: () => Promise<ModelConfig>;
    openApiKeyDialog: (provider: string) => Promise<void>;
    // ⚠️ 无 setApiKey -- API Key 通过主进程原生 dialog 输入
  };
  system?: {
    onLog?: (cb: (entry: LogEntry) => void) => () => void;
    onToolConfirm?: (cb: (req: ToolConfirmRequest) => Promise<ToolConfirmResponse>) => void;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
