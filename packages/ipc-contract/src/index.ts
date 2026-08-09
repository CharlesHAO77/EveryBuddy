/**
 * IPC 契约 - 渲染进程与主进程之间的类型安全通信协议。
 *
 * 命名空间（见 docs/architecture.md §6.1）：
 *  - agent:*    agent 操作触发与事件推送
 *  - session:*  会话管理（task 语义）
 *  - config:*   配置与凭证（不传递 API Key 明文）
 *  - system:*   应用级事件
 *
 * 安全关键：此处不定义任何传递 API Key 明文的类型（setApiKey 只写不读）。
 *
 * @see docs/architecture.md §6
 */
import { z } from "zod";

// ────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────

/** 用户附带的本地文件（发送时由主进程复制到任务工作目录，Agent 按需解析读取） */
export interface AttachmentRef {
  /** 原始文件名（用于展示） */
  name: string;
  /** 本地绝对路径（经 webUtils.getPathForFile 获取） */
  path: string;
  /** 文件字节数 */
  size: number;
  /** 渲染进程探测的 MIME（参考信息） */
  mimeType?: string;
}

/** 发送用户消息请求（见 §6.2 agent:prompt） */
export interface PromptRequest {
  sessionId: string;
  text: string;
  providerId?: string;
  /** 随消息发送的附件（发送时复制到工作目录 uploads/，由 Agent 决定何时解析） */
  attachments?: AttachmentRef[];
}

/** agent:prompt 返回 */
export interface PromptResponse {
  streamId: string;
}

/**
 * 统一事件流（见 §0.4 卡片化消息模型）。
 * pi-coding-agent 的内容块粒度事件经 AgentRuntime 归一化为此类型。
 * streamId = taskId；contentIndex 标识块在消息内的序号，用于按序渲染卡片。
 */
export type AgentEvent =
  // 消息生命周期
  | { streamId: string; type: "message_start" }
  | { streamId: string; type: "message_end"; payload: { stopReason?: string } }
  | { streamId: string; type: "turn_end" }
  | { streamId: string; type: "agent_end" }
  | { streamId: string; type: "agent_settled" }
  | { streamId: string; type: "error"; payload: { message: string } }
  // 思考块
  | { streamId: string; type: "thinking_start"; payload: { contentIndex: number } }
  | {
      streamId: string;
      type: "thinking_delta";
      payload: { contentIndex: number; delta: string };
    }
  | {
      streamId: string;
      type: "thinking_end";
      payload: { contentIndex: number; content: string };
    }
  // 文本块（重点）
  | { streamId: string; type: "text_start"; payload: { contentIndex: number } }
  | {
      streamId: string;
      type: "text_delta";
      payload: { contentIndex: number; delta: string };
    }
  | {
      streamId: string;
      type: "text_end";
      payload: { contentIndex: number; content: string };
    }
  // 工具调用块（LLM 决定调用）
  | {
      streamId: string;
      type: "toolcall_start";
      payload: { contentIndex: number; toolCallId: string };
    }
  | {
      streamId: string;
      type: "toolcall_delta";
      payload: { contentIndex: number; delta: string };
    }
  | {
      streamId: string;
      type: "toolcall_end";
      payload: {
        contentIndex: number;
        toolCall: { id: string; name: string; arguments: unknown };
      };
    }
  // 工具执行（实际运行）
  | {
      streamId: string;
      type: "tool_execution_start";
      payload: { toolCallId: string; toolName: string; args: unknown };
    }
  | {
      streamId: string;
      type: "tool_execution_update";
      payload: { toolCallId: string; delta: string };
    }
  | {
      streamId: string;
      type: "tool_execution_end";
      payload: {
        toolCallId: string;
        ok: boolean;
        output?: unknown;
        error?: string;
      };
    };

// ────────────────────────────────────────────────
// Workspace
// ────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  path: string;
  createdAt: string;
}

// ────────────────────────────────────────────────
// Task（= 会话）
// ────────────────────────────────────────────────

export type TaskType = "temp" | "workspace";

/** Agent 模式：日常办公 / 代码开发（对应 uiStore.activeCategory；决定使用哪份 agent 配置） */
export type AgentMode = "daily" | "coding";

export interface TaskMeta {
  id: string;
  title: string;
  type: TaskType;
  /** 任务所属 agent 模式（缺省 "daily"；决定 createTaskSession 使用 office/coding 配置） */
  mode?: AgentMode;
  workspaceId?: string;
  workspacePath?: string;
  /** 临时任务的工作目录（app 托管，位于 work-spaces/ 下；空间任务无此字段） */
  workDir?: string;
  /** 当前任务使用的模型 provider ID */
  providerId?: string;
  /** 会话 jsonl 落盘目录 */
  sessionDir: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskRequest {
  title?: string;
  type: TaskType;
  /** 创建任务时指定的 agent 模式 */
  mode?: AgentMode;
  workspaceId?: string;
  /** 创建任务时指定的模型 provider ID */
  providerId?: string;
}

// ────────────────────────────────────────────────
// History（历史消息回放，结构与渲染进程 ContentBlock/ChatMessage 对齐）
// ────────────────────────────────────────────────

export interface HistoryThinkingBlock {
  id: string;
  kind: "thinking";
  content: string;
  done: boolean;
}

export interface HistoryTextBlock {
  id: string;
  kind: "text";
  content: string;
  done: boolean;
}

export interface HistoryToolBlock {
  id: string;
  kind: "tool";
  toolCallId: string;
  toolName: string;
  args: unknown;
  argDelta: string;
  status: "calling" | "running" | "success" | "error";
  output: unknown;
  error?: string;
  outputDelta: string;
  done: boolean;
}

export interface HistoryFileBlock {
  id: string;
  kind: "file";
  /** 附件文件名（回放时取 uploads 副本的 basename 展示） */
  name: string;
  size?: number;
  done: boolean;
  /** 附件暂存/复制失败时的提示 */
  error?: string;
}

export type HistoryBlock =
  | HistoryThinkingBlock
  | HistoryTextBlock
  | HistoryToolBlock
  | HistoryFileBlock;

export interface HistoryMessage {
  id: string;
  role: "user" | "assistant";
  blocks: HistoryBlock[];
  timestamp: number;
  errorMessage?: string;
}

// ────────────────────────────────────────────────
// Config（模型配置，不含 API Key 明文）
// ────────────────────────────────────────────────

/**
 * 模型能力标签：
 *  - vision   视觉理解（映射 SDK models[].input = ["text","image"]，决定是否把图片发给该模型）
 *  - imageGen 生图（供 generate_image 工具调度）
 */
export interface ModelCapabilities {
  vision: boolean;
  imageGen: boolean;
}

/** 模型配置（回传渲染进程时 hasApiKey 替代明文，见 §0.2） */
export interface ModelProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isOpenAiCompatible: boolean;
  hasApiKey: boolean;
  capabilities: ModelCapabilities;
}

export interface SaveModelRequest {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isOpenAiCompatible: boolean;
  capabilities: ModelCapabilities;
}

export interface SetApiKeyRequest {
  providerId: string;
  apiKey: string;
}

// ────────────────────────────────────────────────
// System
// ────────────────────────────────────────────────

export interface LogEntry {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
}

// ────────────────────────────────────────────────
// Zod schemas（运行时校验，见 §7.2）
// ────────────────────────────────────────────────

export const attachmentRefSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  size: z.number().nonnegative(),
  mimeType: z.string().optional(),
});

export const promptRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    text: z.string().default(""),
    providerId: z.string().optional(),
    attachments: z.array(attachmentRefSchema).optional().default([]),
  })
  .refine((v) => v.text.trim().length > 0 || (v.attachments?.length ?? 0) > 0, {
    message: "文本或附件至少需要一项",
  });

export const abortRequestSchema = z.object({
  streamId: z.string().min(1),
});

export const createTaskRequestSchema = z.object({
  title: z.string().optional(),
  type: z.enum(["temp", "workspace"]),
  mode: z.enum(["daily", "coding"]).optional(),
  workspaceId: z.string().optional(),
  providerId: z.string().optional(),
});

export const setTaskProviderRequestSchema = z.object({
  taskId: z.string().min(1),
  providerId: z.string().min(1),
});

export const saveModelRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  isOpenAiCompatible: z.boolean(),
  capabilities: z.object({
    vision: z.boolean(),
    imageGen: z.boolean(),
  }),
});

export const setApiKeyRequestSchema = z.object({
  providerId: z.string().min(1),
  apiKey: z.string().min(1),
});

export const idRequestSchema = z.object({ id: z.string().min(1) });

export const renameTaskRequestSchema = z.object({
  id: z.string().min(1, "参数缺失"),
  title: z.string().min(1, "参数缺失"),
});

export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1, "参数缺失"),
  dirPath: z.string().min(1, "参数缺失"),
});

export const createNamedWorkspaceRequestSchema = z.object({
  name: z.string().min(1, "参数缺失"),
});

export const openPathRequestSchema = z.object({
  path: z.string().min(1, "参数缺失"),
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
  task: {
    list: () => Promise<TaskMeta[]>;
    create: (req: CreateTaskRequest) => Promise<TaskMeta>;
    resume: (id: string) => Promise<void>;
    loadHistory: (id: string) => Promise<HistoryMessage[]>;
    delete: (id: string) => Promise<void>;
    rename: (id: string, title: string) => Promise<void>;
    setProvider: (taskId: string, providerId: string) => Promise<void>;
    openDir: (id: string) => Promise<void>;
  };
  workspace: {
    list: () => Promise<Workspace[]>;
    create: (name: string, dirPath: string) => Promise<Workspace>;
    createNamed: (name: string) => Promise<Workspace>;
    remove: (id: string) => Promise<void>;
    selectDir: () => Promise<string | null>;
    openDir: (path: string) => Promise<void>;
  };
  config: {
    getModels: () => Promise<ModelProviderConfig[]>;
    saveModel: (req: SaveModelRequest) => Promise<ModelProviderConfig>;
    removeModel: (id: string) => Promise<void>;
    setApiKey: (req: SetApiKeyRequest) => Promise<void>;
  };
  system: {
    /** 从渲染进程 File 对象取得本地绝对路径（Electron 32+ 移除 File.path） */
    getPathForFile: (file: File) => string;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
