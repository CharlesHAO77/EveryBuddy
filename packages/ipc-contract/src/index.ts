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
 * 单条 assistant 消息的 token 用量与费用（来自 SDK AssistantMessage.usage，JSONL 已持久化）。
 * cost 单位为元（SDK 按模型定价计算）；>0 即展示，无则不显示。
 */
export interface MessageUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  /** 推理 token（output 的子集，provider 不上报时缺省） */
  reasoning?: number;
  cost?: { input: number; output: number; total: number };
}

/**
 * 统一事件流（见 §0.4 卡片化消息模型）。
 * pi-coding-agent 的内容块粒度事件经 AgentRuntime 归一化为此类型。
 * streamId = taskId；contentIndex 标识块在消息内的序号，用于按序渲染卡片。
 */
export type AgentEvent =
  // 消息生命周期
  // message_start 携带 SDK 自身时间戳（避免主/渲染双进程时钟偏差），用于 entryId 匹配锚点
  | { streamId: string; type: "message_start"; payload: { sdkTimestamp: number } }
  | {
      streamId: string;
      type: "message_end";
      payload: {
        stopReason?: string;
        /** 本条 assistant 消息的 token 用量/费用（SDK usage，>0 即展示） */
        usage?: MessageUsage;
        model?: string;
        provider?: string;
      };
    }
  | { streamId: string; type: "turn_end" }
  | { streamId: string; type: "agent_end" }
  | { streamId: string; type: "agent_settled" }
  // agent_settled 后下发：assistant 条目 id 映射（按 sdkTimestamp 匹配），供分支锚点使用
  | {
      streamId: string;
      type: "message_entry_ids";
      payload: { entries: Array<{ sdkTimestamp: number; entryId: string }> };
    }
  // SDK 排队状态（steer/followUp 队列），驱动「已排队」指示
  | {
      streamId: string;
      type: "queue_update";
      payload: { steering: string[]; followUp: string[] };
    }
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
        /** 工具名（SDK ToolExecutionEndEvent 携带，供渲染端按工具结果自动收集产物） */
        toolName: string;
        ok: boolean;
        output?: unknown;
        error?: string;
      };
    }
  // 工具权限确认（手动模式下副作用工具调用前，主进程暂停并推送）
  | {
      streamId: string;
      type: "tool_approval_required";
      payload: {
        requestId: string;
        toolCallId: string;
        toolName: string;
        args: unknown;
        /** bash 等任意命令执行标记为危险，供渲染端警示 */
        isDangerous?: boolean;
      };
    }
  // 扩展事件（plan-mode / todo 等桌面适配扩展经 IPC 推送到渲染进程）
  | {
      streamId: string;
      type: "extension_status";
      payload: {
        key: string;
        value?: string;
        lines?: string[];
        /** 扩展自有状态机（如 plan-mode 的 off/plan/ready/executing），供渲染进程做条件渲染 */
        state?: string;
      };
    }
  | {
      streamId: string;
      type: "extension_notify";
      payload: { message: string; level?: "info" | "warn" | "error" };
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

/** 目录条目（workspace:readDir 单层返回，供渲染进程懒加载目录树） */
export interface WorkspaceDirEntry {
  name: string;
  path: string;
  isDir: boolean;
  /** 文件字节数（目录为 undefined） */
  size?: number;
}

/**
 * workspace:readFile 返回（预览按类型分派，见 §6.2）：
 *  - image：base64 dataUrl（图片预览）
 *  - text：UTF-8 文本（Markdown/代码预览）
 *  - binary：非文本或超过文本上限（无法直接预览）
 *  - error：读取失败（文件不存在/权限等），error 为可展示消息
 */
export type ReadFileResult =
  | { kind: "image"; dataUrl: string; mimeType: string; size: number }
  | { kind: "text"; text: string; mimeType: string; size: number }
  | { kind: "binary"; size: number }
  | { kind: "error"; error: string };

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
  /** 任务选用的专家（缺省按 mode 回退到内置专家；custom 专家叠加覆盖字段） */
  expertId?: string;
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
  /** 创建任务时选用的专家（缺省按 mode 回退到内置专家） */
  expertId?: string;
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
  role: "user" | "assistant" | "notice";
  blocks: HistoryBlock[];
  timestamp: number;
  errorMessage?: string;
  /** 压缩边界提示（role === "notice" 时）：SDK 上下文压缩摘要（markdown），持久显示于消息列表 */
  noticeContent?: string;
  /** assistant 消息的 token 用量/费用（JSONL 回放，footer 元数据与计费用） */
  usage?: MessageUsage;
  /** assistant 消息的模型/提供者（footer 展示与模型类型分账用） */
  model?: string;
  provider?: string;
  /** assistant 消息结束原因（"aborted" 回放时呈现「已取消」） */
  stopReason?: string;
}

// ────────────────────────────────────────────────
// Config（模型配置，不含 API Key 明文）
// ────────────────────────────────────────────────

/** 模型类型：llm 纯对话 / vlm 视觉理解（可对话+识图）/ image 生图（不可对话） */
export type ModelType = "llm" | "vlm" | "image";

/**
 * 模型能力标签（由 ModelType 派生，保留供 SDK 调度兼容）：
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
  /** 显式类型；读取时对缺省条目由 capabilities 推断，故恒有值 */
  type: ModelType;
  /** 该类型下的激活（默认）模型，每类型至多一个 */
  active: boolean;
}

export interface SaveModelRequest {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  isOpenAiCompatible: boolean;
  /** 唯一类型来源；capabilities 由主进程据此派生（不再从渲染进程收） */
  type: ModelType;
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
// Schedule（自动化 / 定时任务）
// ────────────────────────────────────────────────

/** 调度规则：cron 周期（预设即 cron 字符串，本地时区）或一次性（ISO 时间；「N 分钟后」创建时折算） */
export type ScheduleSpec = { type: "cron"; cron: string } | { type: "once"; runAt: string };

/** 运行状态：pending 排队 / running 运行中 / success 成功 / failed 失败 / cancelled 取消 / skipped 跳过 */
export type RunStatus = "pending" | "running" | "success" | "failed" | "cancelled" | "skipped";

export interface ScheduledTask {
  id: string;
  title: string;
  /** 到点自动执行的提示词 */
  prompt: string;
  spec: ScheduleSpec;
  /** 使用哪个 agent 模式配置（daily/coding） */
  mode: AgentMode;
  /** 指定模型 provider（缺省用模式默认） */
  providerId?: string;
  /** 暂停/恢复 */
  enabled: boolean;
  /** 完成后是否系统通知 */
  notify: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  /** 最近一次运行状态（卡片便捷徽标） */
  lastStatus?: RunStatus;
}

export interface ScheduledRun {
  id: string;
  taskId: string;
  status: RunStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** 运行产出（assistant 文本，主进程截断后） */
  result?: string;
  error?: string;
  /** 本次运行 token 用量/费用（复用 MessageUsage） */
  usage?: MessageUsage;
}

export interface CreateScheduleTaskRequest {
  title: string;
  prompt: string;
  spec: ScheduleSpec;
  mode?: AgentMode;
  providerId?: string;
  notify?: boolean;
}

export interface UpdateScheduleTaskRequest {
  id: string;
  title?: string;
  prompt?: string;
  spec?: ScheduleSpec;
  mode?: AgentMode;
  providerId?: string;
  enabled?: boolean;
  notify?: boolean;
}

/** 调度事件推送（主进程 → 渲染进程，schedule:event） */
export type ScheduleEvent =
  | { type: "task_updated"; payload: { task: ScheduledTask } }
  | { type: "task_deleted"; payload: { id: string } }
  | { type: "run_started"; payload: { run: ScheduledRun } }
  | { type: "run_finished"; payload: { run: ScheduledRun; task: ScheduledTask } };

// ────────────────────────────────────────────────
// Expert / Team / Skill / Connector（专家·技能·连接器）
// ────────────────────────────────────────────────

/** 专家来源：builtin 内置（代码内 const）/ custom 自定义（experts.json）/ installed 第三方安装 */
export type ExpertSource = "builtin" | "custom" | "installed";

/** 专家：当前 daily/coding 模式的泛化（复用 AgentConfig 字段；builtin 映射 agent-*.json） */
export interface Expert {
  id: string;
  name: string;
  /** icon key（renderer 专家图标集：briefcase/code/clipboard/palette/monitor/...） */
  icon: string;
  description: string;
  /** 基于哪个 prompt builder（决定默认工具/扩展/提示词骨架） */
  mode: AgentMode;
  /** 覆盖模式默认提示词（缺省由 main/prompts/*.ts builder 生成） */
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  tools?: string[];
  extensions?: string[];
  defaultModelProviderId?: string;
  visionModelProviderId?: string;
  imageGenModelProviderId?: string;
  /** 预留标签（保留命名空间 domain:*、capability:*、source:*、team:*） */
  tags: string[];
  source: ExpertSource;
  createdAt: string;
  updatedAt: string;
}

export interface CreateExpertRequest {
  name: string;
  icon?: string;
  description?: string;
  mode?: AgentMode;
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  tools?: string[];
  extensions?: string[];
  defaultModelProviderId?: string;
  visionModelProviderId?: string;
  imageGenModelProviderId?: string;
  tags?: string[];
}

export interface UpdateExpertRequest {
  id: string;
  name?: string;
  icon?: string;
  description?: string;
  mode?: AgentMode;
  /** 内置专家：空串（""）= 清除覆盖、回退 main/prompts/*.ts 模式默认 */
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  tools?: string[];
  extensions?: string[];
  /** null 表示清除覆盖、回退模式默认 */
  defaultModelProviderId?: string | null;
  visionModelProviderId?: string | null;
  imageGenModelProviderId?: string | null;

  tags?: string[];
}

/** 专家表单「工具/扩展」列表选择目录条目 */
export interface ExpertCatalogTool {
  name: string;
  description: string;
}

export interface ExpertCatalogExtension {
  name: string;
  description: string;
  /** 恒启用（如 permission 权限门禁），UI 灰态不可勾选 */
  alwaysOn?: boolean;
}

/** 专家中心可选项目录（平台工具 + 扩展清单 + 模式默认提示词/工具/扩展），经 expert:catalog 只读下发 */
export interface ExpertCatalog {
  tools: ExpertCatalogTool[];
  extensions: ExpertCatalogExtension[];
  /** 各模式默认系统提示词（main/prompts/*.ts builder 生成），内置专家详情展示用 */
  modePrompts: Record<AgentMode, string>;
  /** 各模式默认工具（内置专家详情自动勾选用） */
  defaultTools: Record<AgentMode, string[]>;
  /** 各模式默认扩展（内置专家详情自动勾选用） */
  defaultExtensions: Record<AgentMode, string[]>;
}

/** 专家团路由策略：本轮仅 "manual"；"auto" dispatcher / "workflow" 编排为后续（预留） */
export type TeamRoutingStrategy = "manual" | "auto" | "workflow";

/** 专家团（本轮仅登记成员 + 手动切换；Agent 团队调度 / Workflow 编排后续实现） */
export interface ExpertTeam {
  id: string;
  name: string;
  icon: string;
  description: string;
  expertIds: string[];
  tags: string[];
  routingStrategy: TeamRoutingStrategy;
  sharedTools?: string[];
  sharedExtensions?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamRequest {
  name: string;
  icon?: string;
  description?: string;
  expertIds?: string[];
  tags?: string[];
  routingStrategy?: TeamRoutingStrategy;
  sharedTools?: string[];
  sharedExtensions?: string[];
}

export interface UpdateTeamRequest {
  id: string;
  name?: string;
  icon?: string;
  description?: string;
  expertIds?: string[];
  tags?: string[];
  routingStrategy?: TeamRoutingStrategy;
  sharedTools?: string[] | null;
  sharedExtensions?: string[] | null;
}

/** 技能来源（对齐 SDK Skill + EveryBuddy 管理） */
export type SkillSource = "global" | "project" | "custom" | "builtin" | "installed";

/** 技能条目（对齐 pi SDK Skill；filePath/baseDir 供编辑器与 skillsOverride 读取） */
export interface SkillEntry {
  /** id = skill name（SDK 约定，= 目录名） */
  id: string;
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: SkillSource;
  tags: string[];
  enabled: boolean;
  installedAt?: string;
}

export interface CreateSkillRequest {
  /** skill 名（kebab-case，= 目录名） */
  name: string;
  description: string;
  /** SKILL.md 正文（frontmatter 之外） */
  content: string;
  tags?: string[];
}

export interface UpdateSkillRequest {
  id: string;
  name?: string;
  description?: string;
  content?: string;
  tags?: string[];
}

export interface InstallSkillRequest {
  /** 本地技能包目录（含 SKILL.md）或 SKILL.md 文件绝对路径 */
  sourcePath: string;
}

export interface EnableSkillRequest {
  id: string;
  enabled: boolean;
}

/** 连接器类型（开放枚举，未来扩展不改 schema） */
export type ConnectorType = "mcp" | "http-api" | "datasource" | "filesystem" | "custom";

/** 连接器状态：connected 已接入 / disconnected 未连接 / error 错误 / reserved 已注册待激活 */
export type ConnectorStatus = "connected" | "disconnected" | "error" | "reserved";

/** 连接器（外部能力接入点；capabilities/tags 预留扩展） */
export interface Connector {
  id: string;
  name: string;
  type: ConnectorType;
  icon: string;
  description: string;
  /** type-specific 透传配置，由 per-type 校验（mcp: command/args/env/transport；http-api: endpoint/auth；filesystem: rootDir） */
  config: Record<string, unknown>;
  tags: string[];
  /** 预留：声明提供什么（tools/context/knowledge/actions），未来按此决定注入方式 */
  capabilities: string[];
  boundExpertIds: string[];
  boundSkillIds: string[];
  enabled: boolean;
  status: ConnectorStatus;
  /** 最近一次连接成功探测到的工具名列表（mcp，供 UI 展示；空/未连接则无） */
  lastTools?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateConnectorRequest {
  name: string;
  type: ConnectorType;
  icon?: string;
  description?: string;
  config?: Record<string, unknown>;
  tags?: string[];
  capabilities?: string[];
  boundExpertIds?: string[];
  boundSkillIds?: string[];
}

export interface UpdateConnectorRequest {
  id: string;
  name?: string;
  type?: ConnectorType;
  icon?: string;
  description?: string;
  config?: Record<string, unknown>;
  tags?: string[];
  capabilities?: string[];
  boundExpertIds?: string[];
  boundSkillIds?: string[];
  enabled?: boolean;
  status?: ConnectorStatus;
  /** 最近一次连接成功探测到的工具名列表（mcp） */
  lastTools?: string[];
}

export interface TestConnectorRequest {
  id: string;
}

/** connector:test 返回 */
export interface ConnectorTestResult {
  status: ConnectorStatus;
  message: string;
  /** 探测到的工具数量（mcp 为 listTools 数量） */
  tools?: number;
  /** 探测到的工具名列表（mcp 连接成功后填充，供 UI 展示） */
  toolNames?: string[];
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
  expertId: z.string().optional(),
  workspaceId: z.string().optional(),
  providerId: z.string().optional(),
});

export const setTaskProviderRequestSchema = z.object({
  taskId: z.string().min(1),
  providerId: z.string().min(1),
});

export const modelTypeSchema = z.enum(["llm", "vlm", "image"]);

export const saveModelRequestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  model: z.string().min(1),
  isOpenAiCompatible: z.boolean(),
  type: modelTypeSchema,
});

export const setApiKeyRequestSchema = z.object({
  providerId: z.string().min(1),
  apiKey: z.string().min(1),
});

export const idRequestSchema = z.object({ id: z.string().min(1) });

/** task:branch 请求：从指定 assistant 条目分叉出新会话（entryId 为会话 JSONL 条目 id） */
export const branchRequestSchema = z.object({
  taskId: z.string().min(1, "参数缺失"),
  entryId: z.string().min(1, "参数缺失"),
});
export type BranchRequest = z.infer<typeof branchRequestSchema>;

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

/** system:openExternal 请求：用系统默认浏览器打开外链（仅 http/https） */
export const openExternalRequestSchema = z.object({
  url: z.string().min(1, "参数缺失"),
});
export type OpenExternalRequest = z.infer<typeof openExternalRequestSchema>;

/** 读取目录单层条目（懒加载目录树用） */
export const readDirRequestSchema = z.object({
  path: z.string().min(1, "参数缺失"),
});

/** 扩展命令请求（如 plan-mode toggle） */
export const extensionCommandRequestSchema = z.object({
  taskId: z.string().min(1, "参数缺失"),
  extension: z.string().min(1, "参数缺失"),
  command: z.string().min(1, "参数缺失"),
});
export type ExtensionCommandRequest = z.infer<typeof extensionCommandRequestSchema>;

/** 执行模式：auto 自动执行 / manual 手动确认 / plan 计划模式 */
export const executionModeSchema = z.enum(["auto", "manual", "plan"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

/** agent:set-mode 请求：切换某任务的执行模式 */
export const setModeRequestSchema = z.object({
  taskId: z.string().min(1, "参数缺失"),
  mode: executionModeSchema,
});
export type SetModeRequest = z.infer<typeof setModeRequestSchema>;

/** agent:approveTool 请求：应答工具权限确认（requestId 来自 tool_approval_required 事件） */
export const approveToolRequestSchema = z.object({
  taskId: z.string().min(1, "参数缺失"),
  requestId: z.string().min(1, "参数缺失"),
  approved: z.boolean(),
});
export type ApproveToolRequest = z.infer<typeof approveToolRequestSchema>;

/** 调度规则 schema（cron 语法由主进程 cron-parser 校验，此处不引入依赖） */
export const scheduleSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), cron: z.string().min(1, "cron 表达式不能为空") }),
  z.object({ type: z.literal("once"), runAt: z.string().min(1, "运行时间不能为空") }),
]);
export type ScheduleSpecZ = z.infer<typeof scheduleSpecSchema>;

/** schedule:create-task 请求 */
export const createScheduleTaskRequestSchema = z.object({
  title: z.string().min(1, "标题不能为空"),
  prompt: z.string().min(1, "提示词不能为空"),
  spec: scheduleSpecSchema,
  mode: z.enum(["daily", "coding"]).default("daily"),
  providerId: z.string().optional(),
  notify: z.boolean().default(true),
});
export type CreateScheduleTaskRequestZ = z.infer<typeof createScheduleTaskRequestSchema>;

/** schedule:update-task 请求（全可选，变更触发重排定时器） */
export const updateScheduleTaskRequestSchema = z.object({
  id: z.string().min(1, "参数缺失"),
  title: z.string().min(1, "标题不能为空").optional(),
  prompt: z.string().min(1, "提示词不能为空").optional(),
  spec: scheduleSpecSchema.optional(),
  mode: z.enum(["daily", "coding"]).optional(),
  providerId: z.string().optional(),
  enabled: z.boolean().optional(),
  notify: z.boolean().optional(),
});
export type UpdateScheduleTaskRequestZ = z.infer<typeof updateScheduleTaskRequestSchema>;

/** schedule:run-now / delete-task / list-runs 请求 */
export const scheduleIdRequestSchema = z.object({ id: z.string().min(1, "参数缺失") });

// ── expert:*（专家） ──
export const expertCreateRequestSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  icon: z.string().min(1).default("briefcase"),
  description: z.string().default(""),
  mode: z.enum(["daily", "coding"]).default("daily"),
  systemPrompt: z.string().optional(),
  appendSystemPrompt: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  defaultModelProviderId: z.string().optional(),
  visionModelProviderId: z.string().optional(),
  imageGenModelProviderId: z.string().optional(),
  tags: z.array(z.string()).default([]),
});
export type ExpertCreateRequestZ = z.infer<typeof expertCreateRequestSchema>;

export const expertUpdateRequestSchema = z.object({
  id: z.string().min(1, "参数缺失"),
  name: z.string().min(1, "名称不能为空").optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  mode: z.enum(["daily", "coding"]).optional(),
  systemPrompt: z.string().optional(),
  appendSystemPrompt: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  defaultModelProviderId: z.string().nullable().optional(),
  visionModelProviderId: z.string().nullable().optional(),
  imageGenModelProviderId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
});
export type ExpertUpdateRequestZ = z.infer<typeof expertUpdateRequestSchema>;

export const expertIdRequestSchema = z.object({ id: z.string().min(1, "参数缺失") });

/** expert:reset 请求 = 仅内置专家可重置，删除 override 回退模式默认 */
export const expertResetRequestSchema = expertIdRequestSchema;

// ── team:*（专家团） ──
export const teamRoutingStrategySchema = z.enum(["manual", "auto", "workflow"]);

export const teamCreateRequestSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  icon: z.string().min(1).default("users"),
  description: z.string().default(""),
  expertIds: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  routingStrategy: teamRoutingStrategySchema.default("manual"),
  sharedTools: z.array(z.string()).optional(),
  sharedExtensions: z.array(z.string()).optional(),
});
export type TeamCreateRequestZ = z.infer<typeof teamCreateRequestSchema>;

export const teamUpdateRequestSchema = z.object({
  id: z.string().min(1, "参数缺失"),
  name: z.string().min(1, "名称不能为空").optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  expertIds: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  routingStrategy: teamRoutingStrategySchema.optional(),
  sharedTools: z.array(z.string()).nullable().optional(),
  sharedExtensions: z.array(z.string()).nullable().optional(),
});
export type TeamUpdateRequestZ = z.infer<typeof teamUpdateRequestSchema>;

export const teamIdRequestSchema = z.object({ id: z.string().min(1, "参数缺失") });

// ── skill:*（技能） ──
export const skillCreateRequestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "技能名需小写字母开头，仅限小写字母/数字/连字符"),
  description: z.string().min(1, "描述不能为空"),
  /** SKILL.md 正文（frontmatter 之外） */
  content: z.string().min(1, "技能内容不能为空"),
  tags: z.array(z.string()).default([]),
});
export type SkillCreateRequestZ = z.infer<typeof skillCreateRequestSchema>;

export const skillUpdateRequestSchema = z.object({
  id: z.string().min(1, "参数缺失"),
  name: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type SkillUpdateRequestZ = z.infer<typeof skillUpdateRequestSchema>;

export const skillEnableRequestSchema = z.object({
  id: z.string().min(1, "参数缺失"),
  enabled: z.boolean(),
});
export type SkillEnableRequestZ = z.infer<typeof skillEnableRequestSchema>;

export const skillInstallRequestSchema = z.object({
  sourcePath: z.string().min(1, "路径不能为空"),
});
export type SkillInstallRequestZ = z.infer<typeof skillInstallRequestSchema>;

export const skillIdRequestSchema = z.object({ id: z.string().min(1, "参数缺失") });

// ── connector:*（连接器） ──
export const connectorTypeSchema = z.enum(["mcp", "http-api", "datasource", "filesystem", "custom"]);
export const connectorStatusSchema = z.enum(["connected", "disconnected", "error", "reserved"]);
export const connectorConfigSchema = z.record(z.unknown());

export const connectorCreateRequestSchema = z.object({
  name: z.string().min(1, "名称不能为空"),
  type: connectorTypeSchema,
  icon: z.string().min(1).default("hub"),
  description: z.string().default(""),
  config: connectorConfigSchema.default({}),
  tags: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  boundExpertIds: z.array(z.string()).default([]),
  boundSkillIds: z.array(z.string()).default([]),
});
export type ConnectorCreateRequestZ = z.infer<typeof connectorCreateRequestSchema>;

export const connectorUpdateRequestSchema = z.object({
  id: z.string().min(1, "参数缺失"),
  name: z.string().min(1, "名称不能为空").optional(),
  type: connectorTypeSchema.optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  config: connectorConfigSchema.optional(),
  tags: z.array(z.string()).optional(),
  capabilities: z.array(z.string()).optional(),
  boundExpertIds: z.array(z.string()).optional(),
  boundSkillIds: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  status: connectorStatusSchema.optional(),
});
export type ConnectorUpdateRequestZ = z.infer<typeof connectorUpdateRequestSchema>;

export const connectorIdRequestSchema = z.object({ id: z.string().min(1, "参数缺失") });
export const connectorTestRequestSchema = z.object({ id: z.string().min(1, "参数缺失") });

// ────────────────────────────────────────────────
// Preload API 形状（见 §6.3）
// ────────────────────────────────────────────────

export interface ElectronAPI {
  agent: {
    prompt: (req: PromptRequest) => Promise<PromptResponse>;
    abort: (streamId: string) => Promise<void>;
    /** 转向：打断当前生成并处理新消息（空闲时等同 prompt） */
    steer: (req: PromptRequest) => Promise<PromptResponse>;
    /** 排队：当前生成完成后自动处理（空闲时等同 prompt） */
    followUp: (req: PromptRequest) => Promise<PromptResponse>;
    /** 清空排队（steer + followUp），返回被清空的内容；用于单项取消后重排 */
    clearQueue: (streamId: string) => Promise<{ steering: string[]; followUp: string[] }>;
    onEvent: (cb: (event: AgentEvent) => void) => () => void;
    extensionCommand: (req: ExtensionCommandRequest) => Promise<void>;
    /** 切换任务执行模式（auto/manual/plan） */
    setMode: (req: SetModeRequest) => Promise<void>;
    /** 应答工具权限确认 */
    approveTool: (req: ApproveToolRequest) => Promise<void>;
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
    /** 从指定 assistant 条目分叉出新会话，返回新任务 */
    branch: (req: BranchRequest) => Promise<TaskMeta>;
  };
  workspace: {
    list: () => Promise<Workspace[]>;
    create: (name: string, dirPath: string) => Promise<Workspace>;
    createNamed: (name: string) => Promise<Workspace>;
    remove: (id: string) => Promise<void>;
    selectDir: () => Promise<string | null>;
    openDir: (path: string) => Promise<void>;
    /** 读取目录单层条目（懒加载目录树） */
    readDir: (path: string) => Promise<WorkspaceDirEntry[]>;
    /** 在系统文件管理器中显示该文件（选中高亮）；文件已删除则兜底打开父目录 */
    revealPath: (path: string) => Promise<void>;
    /** 读取文件内容用于预览（主进程按扩展名分类，返回 ReadFileResult） */
    readFile: (path: string) => Promise<ReadFileResult>;
  };
  config: {
    getModels: () => Promise<ModelProviderConfig[]>;
    saveModel: (req: SaveModelRequest) => Promise<ModelProviderConfig>;
    removeModel: (id: string) => Promise<void>;
    setApiKey: (req: SetApiKeyRequest) => Promise<void>;
    /** 将某模型设为该类型下的激活模型（每类型一个），持久化到 models.json */
    setActiveModel: (id: string) => Promise<void>;
  };
  system: {
    /** 从渲染进程 File 对象取得本地绝对路径（Electron 32+ 移除 File.path） */
    getPathForFile: (file: File) => string;
    /** 用系统默认浏览器打开外链（markdown 链接用，主进程仅放行 http/https） */
    openExternal: (url: string) => Promise<void>;
  };
  schedule: {
    listTasks: () => Promise<ScheduledTask[]>;
    createTask: (req: CreateScheduleTaskRequest) => Promise<ScheduledTask>;
    updateTask: (req: UpdateScheduleTaskRequest) => Promise<ScheduledTask>;
    deleteTask: (id: string) => Promise<void>;
    /** 立即执行一次（测试运行；enabled=false 也可） */
    runNow: (id: string) => Promise<void>;
    /** 某任务的全部运行历史（新→旧） */
    listRuns: (taskId: string) => Promise<ScheduledRun[]>;
    /** 订阅调度事件（任务变更 / 运行开始与结束） */
    onEvent: (cb: (event: ScheduleEvent) => void) => () => void;
  };
  expert: {
    /** builtin + 自定义合并列表（builtin 合并了本地 override） */
    list: () => Promise<Expert[]>;
    create: (req: CreateExpertRequest) => Promise<Expert>;
    /** builtin 写 override（名称/图标/mode 锁定，systemPrompt 空串=清除覆盖）；custom 正常更新 */
    update: (req: UpdateExpertRequest) => Promise<Expert>;
    /** 仅 builtin 可重置：删除 override，回退模式默认 */
    reset: (id: string) => Promise<Expert>;
    /** 专家表单工具/扩展列表选择目录（平台工具 + 扩展清单） */
    catalog: () => Promise<ExpertCatalog>;
    /** 仅 custom 可删 */
    delete: (id: string) => Promise<void>;
  };
  team: {
    list: () => Promise<ExpertTeam[]>;
    create: (req: CreateTeamRequest) => Promise<ExpertTeam>;
    update: (req: UpdateTeamRequest) => Promise<ExpertTeam>;
    delete: (id: string) => Promise<void>;
  };
  skill: {
    /** SDK 发现（global/project）+ EveryBuddy 管理（builtin/custom/installed）合并 */
    list: () => Promise<SkillEntry[]>;
    create: (req: CreateSkillRequest) => Promise<SkillEntry>;
    update: (req: UpdateSkillRequest) => Promise<SkillEntry>;
    /** 本地技能包（目录含 SKILL.md 或单文件）安装到 ~/EveryBuddy/skills/ */
    install: (req: InstallSkillRequest) => Promise<SkillEntry>;
    /** 仅 custom/installed 可卸载；builtin 转停用 */
    uninstall: (id: string) => Promise<void>;
    /** 启停：enabled=false 的技能不并入 skillsOverride */
    enable: (req: EnableSkillRequest) => Promise<void>;
  };
  connector: {
    list: () => Promise<Connector[]>;
    create: (req: CreateConnectorRequest) => Promise<Connector>;
    update: (req: UpdateConnectorRequest) => Promise<Connector>;
    delete: (id: string) => Promise<void>;
    /** 测试连接（mcp 尝试启动并 listTools；reserved 态返回提示） */
    test: (req: TestConnectorRequest) => Promise<ConnectorTestResult>;
  };
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
