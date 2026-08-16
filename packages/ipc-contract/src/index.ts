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

/** agent:compact 请求：手动压缩某任务的会话上下文（/compact） */
export interface CompactRequest {
  taskId: string;
  /** 压缩摘要的自定义指示（SDK 用于指导摘要生成，可选） */
  customInstructions?: string;
}

/** agent:compact 返回：成功时携带摘要；失败时 error 为可展示消息 */
export interface CompactResult {
  ok: boolean;
  /** 压缩摘要（成功时返回，渲染层可结合重载历史展示） */
  summary?: string;
  /** 失败原因（ok=false 时） */
  error?: string;
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
    }
  // 非视觉模型收到图片时，主进程 buildPromptText 直连视觉模型做了隐藏分析——
  // 渲染层收到后把结果作为「视觉理解」工具卡附到紧随的 assistant 消息上（否则分析过程不可见）
  | {
      streamId: string;
      type: "image_analysis";
      payload: {
        images: Array<{ name: string; description: string }>;
      };
    }
  // 子 Agent 事件（专家团 auto 调度的 delegate 工具 / workflow 步骤触发；streamId = 父任务 taskId）
  | {
      streamId: string;
      type: "subagent_start";
      payload: {
        subagentId: string;
        /** 父会话 delegate 工具调用 id（渲染层 findToolBlock 定位父工具块，内嵌子面板） */
        parentToolCallId: string;
        expertId: string;
        expertName: string;
        prompt: string;
        /** workflow 步骤绑定（workflow 内非 undefined；delegate 路径缺省） */
        stepId?: string;
      };
    }
  | {
      streamId: string;
      type: "subagent_delta";
      payload: { subagentId: string; parentToolCallId: string; delta: string; stepId?: string };
    }
  | {
      streamId: string;
      type: "subagent_tool";
      payload: {
        subagentId: string;
        parentToolCallId: string;
        stepId?: string;
        toolName: string;
        toolCallId: string;
        args?: unknown;
        phase: "start" | "update" | "end";
        ok?: boolean;
        output?: unknown;
        error?: string;
      };
    }
  | {
      streamId: string;
      type: "subagent_end";
      payload: {
        subagentId: string;
        parentToolCallId: string;
        stepId?: string;
        status: "ok" | "error" | "aborted";
        text?: string;
        error?: string;
        usage?: MessageUsage;
      };
    }
  // workflow 骨架事件（只发结构，步骤内容走 subagent_*；streamId = 任务 taskId）
  | {
      streamId: string;
      type: "workflow_start";
      payload: { workflowId: string; name: string; stepCount: number };
    }
  | {
      streamId: string;
      type: "workflow_step_start";
      payload: {
        stepId: string;
        expertIds: string[];
        prompt: string;
        kind: "serial" | "parallel" | "conditional";
        /** 条件节点判定结果（满足走 then） */
        pass?: boolean;
      };
    }
  | {
      streamId: string;
      type: "workflow_step_end";
      payload: {
        stepId: string;
        ok: boolean;
        output?: string;
        error?: string;
        usage?: MessageUsage;
        /** 条件节点判定结果（与 start 同步） */
        pass?: boolean;
      };
    }
  | {
      streamId: string;
      type: "workflow_end";
      payload: {
        status: "ok" | "error" | "aborted";
        summary?: string;
        error?: string;
        usage?: MessageUsage;
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
  /** 任务绑定的专家团（与 expertId 互斥；auto 团队→coordinator 会话 + delegate 工具，workflow 团队→无会话走工作流） */
  teamId?: string;
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
  /** 创建任务时绑定的专家团（与 expertId 互斥） */
  teamId?: string;
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

/** 专家团路由策略：manual 手动切换 / auto dispatcher 自动调度子 Agent / workflow 代码流程编排 */
export type TeamRoutingStrategy = "manual" | "auto" | "workflow";

/** 团队来源：builtin 内置示例（代码内 const，不落盘）/ custom 自定义（teams.json）——对齐 Expert.source */
export type TeamSource = "builtin" | "custom";

/** 工作流单步引用（串行单专家 / 并行组内成员） */
export interface WorkflowStepRef {
  id: string;
  expertId: string;
  /** 步骤提示词模板；支持 `{user}`（触发消息）与 `{{stepId.result}}`（引用前步输出）占位 */
  prompt: string;
}

/** 条件规则运算符（确定性本地求值，见 main/workflowCondition.ts，零 token） */
export type WorkflowConditionOp =
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "equals"
  | "not_equals"
  | "starts_with"
  | "ends_with"
  | "len_gt"
  | "len_lt";

/** 条件节点单条规则：引用前序步骤输出 + 运算符 + 值 */
export interface WorkflowConditionRule {
  /** 引用步骤 id（`{{stepId.result}}` 或裸 stepId） */
  var: string;
  op: WorkflowConditionOp;
  value?: string;
}

/** 工作流步骤：串行单专家、并行专家组（同依赖并发）、或条件分支（then/else 嵌套子链） */
export type WorkflowStep =
  | ({ kind: "serial" } & WorkflowStepRef)
  | { kind: "parallel"; id: string; steps: WorkflowStepRef[] }
  | {
      kind: "conditional";
      id: string;
      /** 多条规则间的组合：and 全真 / or 任一真 */
      logic: "and" | "or";
      rules: WorkflowConditionRule[];
      /** 满足分支子链（可空：视为无操作继续） */
      thenSteps: WorkflowStep[];
      /** 否则分支子链（可空） */
      elseSteps?: WorkflowStep[];
    };

/** 节点画布坐标（仅设计器 UI 用，引擎忽略；执行序仍由 steps 数组序决定） */
export interface WorkflowNodeLayout {
  x: number;
  y: number;
}

/** 结构化画布设计的工作流（序列化到团队 workflow，渲染层画布展示 + 右侧面板编辑） */
export interface TeamWorkflow {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  /** 节点画布坐标：stepId -> {x,y}（仅 UI 用，引擎忽略） */
  layout?: Record<string, WorkflowNodeLayout>;
  /** 最终汇总专家（缺省 team.expertIds 末位） */
  summarizerExpertId?: string;
}

// ── 团队运行记录（子 agent / workflow 执行过程持久化，供追溯） ──

/** 子 agent 执行过程记录（存过程轨迹：最终文本 + 工具序列 + 状态 + 用量 + 时间戳，非逐字 delta） */
export interface SubAgentRunRecord {
  subagentId: string;
  /** 父 delegate 工具调用 id（重开后挂回历史工具卡） */
  parentToolCallId: string;
  expertId: string;
  expertName: string;
  prompt: string;
  stepId?: string;
  status: "ok" | "error" | "aborted";
  /** 最终全文（非增量） */
  text: string;
  /** 子工具调用序列（按 toolCallId 升位，保留最新 phase/output） */
  tools: Array<{
    toolName: string;
    toolCallId: string;
    phase: "start" | "update" | "end";
    output?: unknown;
    error?: string;
  }>;
  usage?: MessageUsage;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

/** workflow 单步执行过程记录 */
export interface WorkflowStepRecord {
  stepId: string;
  expertIds: string[];
  kind: "serial" | "parallel" | "conditional";
  status: "pending" | "running" | "ok" | "error";
  /** 该步最终输出（子 agent 文本拼接） */
  output?: string;
  error?: string;
  /** 该步涉及的子 agent 过程 */
  subagents: SubAgentRunRecord[];
}

/** workflow 运行过程记录（status 含 "running" 以支持分步落盘的部分记录） */
export interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  name: string;
  /** 触发工作流的用户消息（重开后重建对话历史用） */
  prompt?: string;
  status: "running" | "ok" | "error" | "aborted";
  steps: WorkflowStepRecord[];
  summary?: string;
  usage?: MessageUsage;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

/** 任务级团队运行记录（任务下所有子 agent 活动 + 最近一次 workflow 运行） */
export interface TeamRunRecord {
  taskId: string;
  subAgents: SubAgentRunRecord[];
  workflowRun?: WorkflowRunRecord;
  updatedAt: number;
}

/** 专家团（routingStrategy 决定运行时行为：manual 手动切换 / auto 子 Agent 调度 / workflow 流程编排） */
export interface ExpertTeam {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** 成员 agent（不含主 agent） */
  expertIds: string[];
  /** 主 agent（auto 团队必选：以该专家人格作为协调者并计入团队人数；manual/workflow 可选） */
  leadExpertId?: string;
  /** 各 agent 角色：key = expertId 或 leadExpertId，value = 角色名（如 协调者/分析师/编码/评审） */
  roles?: Record<string, string>;
  tags: string[];
  routingStrategy: TeamRoutingStrategy;
  sharedTools?: string[];
  sharedExtensions?: string[];
  /** 仅 workflow 策略使用；builtin 示例团队携带完整字面量，custom 可缺省由运行时 buildDefaultWorkflow 生成 */
  workflow?: TeamWorkflow;
  source: TeamSource;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamRequest {
  name: string;
  icon?: string;
  description?: string;
  expertIds?: string[];
  /** 主 agent（auto 团队必选） */
  leadExpertId?: string;
  /** 各 agent 角色：key = expertId 或 leadExpertId，value = 角色名 */
  roles?: Record<string, string>;
  tags?: string[];
  routingStrategy?: TeamRoutingStrategy;
  sharedTools?: string[];
  sharedExtensions?: string[];
  workflow?: TeamWorkflow;
}

export interface UpdateTeamRequest {
  id: string;
  name?: string;
  icon?: string;
  description?: string;
  expertIds?: string[];
  /** null 清除主 agent */
  leadExpertId?: string | null;
  /** null 清除角色 */
  roles?: Record<string, string> | null;
  tags?: string[];
  routingStrategy?: TeamRoutingStrategy;
  sharedTools?: string[] | null;
  sharedExtensions?: string[] | null;
  /** null 清除 workflow（回退运行时 buildDefaultWorkflow） */
  workflow?: TeamWorkflow | null;
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
    message: "errors.textOrAttachmentRequired",
  });

export const abortRequestSchema = z.object({
  streamId: z.string().min(1),
});

/** agent:compact 请求（手动压缩会话上下文；customInstructions 可选） */
export const compactRequestSchema = z.object({
  taskId: z.string().min(1, "errors.paramMissing"),
  customInstructions: z.string().optional(),
});
export type CompactRequestZ = z.infer<typeof compactRequestSchema>;

export const createTaskRequestSchema = z.object({
  title: z.string().optional(),
  type: z.enum(["temp", "workspace"]),
  mode: z.enum(["daily", "coding"]).optional(),
  expertId: z.string().optional(),
  teamId: z.string().optional(),
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
  taskId: z.string().min(1, "errors.paramMissing"),
  entryId: z.string().min(1, "errors.paramMissing"),
});
export type BranchRequest = z.infer<typeof branchRequestSchema>;

export const renameTaskRequestSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
  title: z.string().min(1, "errors.paramMissing"),
});

export const createWorkspaceRequestSchema = z.object({
  name: z.string().min(1, "errors.paramMissing"),
  dirPath: z.string().min(1, "errors.paramMissing"),
});

export const createNamedWorkspaceRequestSchema = z.object({
  name: z.string().min(1, "errors.paramMissing"),
});

export const openPathRequestSchema = z.object({
  path: z.string().min(1, "errors.paramMissing"),
});

/** system:openExternal 请求：用系统默认浏览器打开外链（仅 http/https） */
export const openExternalRequestSchema = z.object({
  url: z.string().min(1, "errors.paramMissing"),
});
export type OpenExternalRequest = z.infer<typeof openExternalRequestSchema>;

/** 读取目录单层条目（懒加载目录树用） */
export const readDirRequestSchema = z.object({
  path: z.string().min(1, "errors.paramMissing"),
});

/** 扩展命令请求（如 plan-mode toggle） */
export const extensionCommandRequestSchema = z.object({
  taskId: z.string().min(1, "errors.paramMissing"),
  extension: z.string().min(1, "errors.paramMissing"),
  command: z.string().min(1, "errors.paramMissing"),
});
export type ExtensionCommandRequest = z.infer<typeof extensionCommandRequestSchema>;

/** 粘贴的剪贴板文件（无真实路径，如截图/复制的图片）base64 暂存请求：主进程写临时文件，返回可读路径 */
export interface StagePastedFileRequest {
  /** 展示用文件名（粘贴时取 file.name，缺失则按 MIME 推断） */
  name: string;
  /** base64 内容（data URL 中逗号之后的部分） */
  data: string;
  /** MIME（如 image/png），用于推断扩展名 */
  mimeType?: string;
}

export const stagePastedFileRequestSchema = z.object({
  name: z.string().min(1, "errors.paramMissing"),
  data: z.string().min(1, "errors.paramMissing"),
  mimeType: z.string().optional(),
});
export type StagePastedFileRequestZ = z.infer<typeof stagePastedFileRequestSchema>;

/** 执行模式：auto 自动执行 / manual 手动确认 / plan 计划模式 */
export const executionModeSchema = z.enum(["auto", "manual", "plan"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

/** agent:set-mode 请求：切换某任务的执行模式 */
export const setModeRequestSchema = z.object({
  taskId: z.string().min(1, "errors.paramMissing"),
  mode: executionModeSchema,
});
export type SetModeRequest = z.infer<typeof setModeRequestSchema>;

/** agent:approveTool 请求：应答工具权限确认（requestId 来自 tool_approval_required 事件） */
export const approveToolRequestSchema = z.object({
  taskId: z.string().min(1, "errors.paramMissing"),
  requestId: z.string().min(1, "errors.paramMissing"),
  approved: z.boolean(),
});
export type ApproveToolRequest = z.infer<typeof approveToolRequestSchema>;

/** 调度规则 schema（cron 语法由主进程 cron-parser 校验，此处不引入依赖） */
export const scheduleSpecSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cron"), cron: z.string().min(1, "errors.cronRequired") }),
  z.object({ type: z.literal("once"), runAt: z.string().min(1, "errors.runAtRequired") }),
]);
export type ScheduleSpecZ = z.infer<typeof scheduleSpecSchema>;

/** schedule:create-task 请求 */
export const createScheduleTaskRequestSchema = z.object({
  title: z.string().min(1, "errors.titleRequired"),
  prompt: z.string().min(1, "errors.promptRequired"),
  spec: scheduleSpecSchema,
  mode: z.enum(["daily", "coding"]).default("daily"),
  providerId: z.string().optional(),
  notify: z.boolean().default(true),
});
export type CreateScheduleTaskRequestZ = z.infer<typeof createScheduleTaskRequestSchema>;

/** schedule:update-task 请求（全可选，变更触发重排定时器） */
export const updateScheduleTaskRequestSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
  title: z.string().min(1, "errors.titleRequired").optional(),
  prompt: z.string().min(1, "errors.promptRequired").optional(),
  spec: scheduleSpecSchema.optional(),
  mode: z.enum(["daily", "coding"]).optional(),
  providerId: z.string().optional(),
  enabled: z.boolean().optional(),
  notify: z.boolean().optional(),
});
export type UpdateScheduleTaskRequestZ = z.infer<typeof updateScheduleTaskRequestSchema>;

/** schedule:run-now / delete-task / list-runs 请求 */
export const scheduleIdRequestSchema = z.object({ id: z.string().min(1, "errors.paramMissing") });

// ── expert:*（专家） ──
export const expertCreateRequestSchema = z.object({
  name: z.string().min(1, "errors.nameRequired"),
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
  id: z.string().min(1, "errors.paramMissing"),
  name: z.string().min(1, "errors.nameRequired").optional(),
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

export const expertIdRequestSchema = z.object({ id: z.string().min(1, "errors.paramMissing") });

/** expert:reset 请求 = 仅内置专家可重置，删除 override 回退模式默认 */
export const expertResetRequestSchema = expertIdRequestSchema;

// ── team:*（专家团） ──
export const teamRoutingStrategySchema = z.enum(["manual", "auto", "workflow"]);

export const workflowStepRefSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
  expertId: z.string().min(1, "errors.paramMissing"),
  prompt: z.string().min(1, "errors.promptRequired"),
});
export type WorkflowStepRefZ = z.infer<typeof workflowStepRefSchema>;

export const workflowConditionRuleSchema = z.object({
  var: z.string().min(1, "errors.paramMissing"),
  op: z.enum([
    "contains",
    "not_contains",
    "is_empty",
    "is_not_empty",
    "equals",
    "not_equals",
    "starts_with",
    "ends_with",
    "len_gt",
    "len_lt",
  ]),
  value: z.string().optional(),
});
export type WorkflowConditionRuleZ = z.infer<typeof workflowConditionRuleSchema>;

/** 递归 workflow 步骤 schema：条件节点内 thenSteps/elseSteps 再引用自身 */
export const workflowStepSchema: z.ZodType<WorkflowStep> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("serial"),
      id: z.string().min(1, "errors.paramMissing"),
      expertId: z.string().min(1, "errors.paramMissing"),
      prompt: z.string().min(1, "errors.promptRequired"),
    }),
    z.object({
      kind: z.literal("parallel"),
      id: z.string().min(1, "errors.paramMissing"),
      steps: z.array(workflowStepRefSchema).min(1, "errors.stepsRequired"),
    }),
    z.object({
      kind: z.literal("conditional"),
      id: z.string().min(1, "errors.paramMissing"),
      logic: z.enum(["and", "or"]),
      rules: z.array(workflowConditionRuleSchema),
      thenSteps: z.array(workflowStepSchema),
      elseSteps: z.array(workflowStepSchema).optional(),
    }),
  ]),
);
export type WorkflowStepZ = z.infer<typeof workflowStepSchema>;

export const workflowNodeLayoutSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const teamWorkflowSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
  name: z.string().min(1, "errors.nameRequired"),
  description: z.string().optional(),
  steps: z.array(workflowStepSchema).min(1, "errors.stepsRequired"),
  layout: z.record(workflowNodeLayoutSchema).optional(),
  summarizerExpertId: z.string().optional(),
});
export type TeamWorkflowZ = z.infer<typeof teamWorkflowSchema>;

export const teamCreateRequestSchema = z.object({
  name: z.string().min(1, "errors.nameRequired"),
  icon: z.string().min(1).default("users"),
  description: z.string().default(""),
  expertIds: z.array(z.string()).default([]),
  leadExpertId: z.string().optional(),
  roles: z.record(z.string()).optional(),
  tags: z.array(z.string()).default([]),
  routingStrategy: teamRoutingStrategySchema.default("manual"),
  sharedTools: z.array(z.string()).optional(),
  sharedExtensions: z.array(z.string()).optional(),
  workflow: teamWorkflowSchema.optional(),
});
export type TeamCreateRequestZ = z.infer<typeof teamCreateRequestSchema>;

export const teamUpdateRequestSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
  name: z.string().min(1, "errors.nameRequired").optional(),
  icon: z.string().optional(),
  description: z.string().optional(),
  expertIds: z.array(z.string()).optional(),
  leadExpertId: z.string().nullable().optional(),
  roles: z.record(z.string()).nullable().optional(),
  tags: z.array(z.string()).optional(),
  routingStrategy: teamRoutingStrategySchema.optional(),
  sharedTools: z.array(z.string()).nullable().optional(),
  sharedExtensions: z.array(z.string()).nullable().optional(),
  workflow: teamWorkflowSchema.nullable().optional(),
});
export type TeamUpdateRequestZ = z.infer<typeof teamUpdateRequestSchema>;

export const teamIdRequestSchema = z.object({ id: z.string().min(1, "errors.paramMissing") });

/** team:get-runs 请求：取任务级团队运行记录（子 agent / workflow 过程追溯） */
export const teamGetRunsRequestSchema = z.object({
  taskId: z.string().min(1, "errors.paramMissing"),
});

/** agent:run-workflow 请求：在绑定 workflow 团队的任务上运行流程（进度经 agent:event 推送 workflow_* + subagent_*） */
export const runWorkflowRequestSchema = z.object({
  taskId: z.string().min(1, "errors.paramMissing"),
  teamId: z.string().min(1, "errors.paramMissing"),
  prompt: z.string().min(1, "errors.promptRequired"),
  providerId: z.string().optional(),
});
export type RunWorkflowRequest = z.infer<typeof runWorkflowRequestSchema>;

// ── skill:*（技能） ──
export const skillCreateRequestSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, "errors.skillNamePattern"),
  description: z.string().min(1, "errors.descriptionRequired"),
  /** SKILL.md 正文（frontmatter 之外） */
  content: z.string().min(1, "errors.skillContentRequired"),
  tags: z.array(z.string()).default([]),
});
export type SkillCreateRequestZ = z.infer<typeof skillCreateRequestSchema>;

export const skillUpdateRequestSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
  name: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
  tags: z.array(z.string()).optional(),
});
export type SkillUpdateRequestZ = z.infer<typeof skillUpdateRequestSchema>;

export const skillEnableRequestSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
  enabled: z.boolean(),
});
export type SkillEnableRequestZ = z.infer<typeof skillEnableRequestSchema>;

export const skillInstallRequestSchema = z.object({
  sourcePath: z.string().min(1, "errors.pathRequired"),
});
export type SkillInstallRequestZ = z.infer<typeof skillInstallRequestSchema>;

export const skillIdRequestSchema = z.object({ id: z.string().min(1, "errors.paramMissing") });

// ── connector:*（连接器） ──
export const connectorTypeSchema = z.enum([
  "mcp",
  "http-api",
  "datasource",
  "filesystem",
  "custom",
]);
export const connectorStatusSchema = z.enum(["connected", "disconnected", "error", "reserved"]);
export const connectorConfigSchema = z.record(z.unknown());

export const connectorCreateRequestSchema = z.object({
  name: z.string().min(1, "errors.nameRequired"),
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
  id: z.string().min(1, "errors.paramMissing"),
  name: z.string().min(1, "errors.nameRequired").optional(),
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

export const connectorIdRequestSchema = z.object({ id: z.string().min(1, "errors.paramMissing") });
export const connectorTestRequestSchema = z.object({
  id: z.string().min(1, "errors.paramMissing"),
});

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
    /** 手动压缩会话上下文（/compact；返回成功/失败与摘要） */
    compact: (req: CompactRequest) => Promise<CompactResult>;
    /** 切换任务执行模式（auto/manual/plan） */
    setMode: (req: SetModeRequest) => Promise<void>;
    /** 应答工具权限确认 */
    approveTool: (req: ApproveToolRequest) => Promise<void>;
    /** 运行团队工作流（workflow 团队任务；进度经 agent:event 推送 workflow_* + subagent_*） */
    runWorkflow: (req: RunWorkflowRequest) => Promise<void>;
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
    /** 粘贴的剪贴板文件（无真实路径）base64 写入临时目录，返回可读路径（发送时由 stageAttachments 复制） */
    stagePastedFile: (req: StagePastedFileRequest) => Promise<string>;
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
    /** 复制为自定义（内置示例团队只读，先复制再编辑） */
    duplicate: (id: string) => Promise<ExpertTeam>;
    /** 任务级团队运行记录（子 agent / workflow 过程追溯；无记录返回 undefined） */
    getRuns: (taskId: string) => Promise<TeamRunRecord | undefined>;
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
