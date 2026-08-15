import type {
  AttachmentRef,
  CreateTaskRequest,
  ExecutionMode,
  HistoryBlock,
  HistoryMessage,
  HistoryTextBlock,
  HistoryThinkingBlock,
  HistoryToolBlock,
  MessageUsage,
  TaskMeta,
  TeamRunRecord,
  Workspace,
} from "@everybuddy/ipc-contract";
import { create } from "zustand";
import { buildUserBlocks, diffDeliveredFollowUps } from "../queue";

// ────────────────────────────────────────────────
// 内容块与消息模型（见 §0.4 卡片化消息模型）
// 单一真源：块类型从 ipc-contract 的 History* 类型派生（AGENTS.md §4.2），
// 此处仅做别名与扩展，不再声明平行接口。
// ────────────────────────────────────────────────

export type ContentBlock = HistoryBlock;
export type ToolBlock = HistoryToolBlock;
export type TextBlock = HistoryTextBlock;
export type ThinkingBlock = HistoryThinkingBlock;

export interface ChatMessage extends HistoryMessage {
  isStreaming?: boolean;
  /** agent 结束时间戳（渲染层内存，用于计算执行时长；历史回放无此字段） */
  endedAt?: number;
  /** 用户取消（abort）标记：呈现「已取消」而非「任务已完成」 */
  cancelled?: boolean;
  /** 原生 steer 转向时被截断的在途消息（渲染层自持，不依赖 stopReason）→ 琥珀「已转向」 */
  redirected?: boolean;
  /** steer 用户消息待交付（原生 steer 在 turn 边界注入）→ 「转向中」chip；交付后清除 */
  steerPending?: boolean;
  /** 单项取消排队时重发 steer 用（渲染层自持） */
  steerReq?: { text: string; providerId?: string; attachments?: AttachmentRef[] };
  /** SDK 消息时间戳（message_start 透传），用于 message_entry_ids 按时间匹配写 entryId */
  sdkTimestamp?: number;
  /** 会话 JSONL 条目 id（分支锚点；回放消息 = 消息 id，流式消息由 message_entry_ids 回填） */
  entryId?: string;
  /** 赞/踩本地 UI 状态（不持久化） */
  feedback?: "up" | "down" | null;
}

/** 渲染层自持的排队记录（显示 + 交付插入 + 单项取消；交付时经 buildUserBlocks 重建用户消息） */
export interface PendingFollowUpItem {
  id: string;
  text: string;
  attachments: AttachmentRef[];
  providerId?: string;
  createdAt: number;
}

export interface Task extends TaskMeta {
  messages: ChatMessage[];
  isStreaming?: boolean;
  /** 当前流式 assistant 消息 id */
  streamMessageId?: string | null;
  /** 已发送、等待首个 assistant 消息（覆盖首 token 前的空白期，渲染「运行中」指示） */
  pending?: boolean;
  /** 用户已请求中止（渲染层意图标记）：finalizeMessage 时据此把在途流式消息置 cancelled */
  abortRequested?: boolean;
  /** 原生 steer 的目标消息 id（首次转向时捕获在途消息；多次转向合并指向同一目标，交付时置一次 `redirected` 并清除） */
  steerTargetId?: string | null;
}

/** 扩展状态（extension_status 事件负载；state 为扩展自有状态机，如 plan-mode 的 off/plan/ready/executing） */
export interface ExtensionStatus {
  value?: string;
  lines?: string[];
  state?: string;
}

/** 右侧预览 tab 的单个可预览项（最近结果 strip 中的 chip） */
export interface PreviewItem {
  id: string;
  kind: "image" | "file";
  name: string;
  /** 文件绝对路径（生成图片为 cwd 拼接相对路径，混合分隔符由主进程归一） */
  absPath: string;
}

/** 待人工确认的工具调用（tool_approval_required 事件负载） */
export interface PendingToolApproval {
  requestId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  isDangerous?: boolean;
}

/** 对话内居中提示条（extension_notify 负载，4s 自动消失） */
export interface ChatNotice {
  id: string;
  message: string;
  level: "info" | "warn" | "error";
}

/** 子 Agent 实时状态（subagent_* 事件驱动；挂到父 delegate 工具块内嵌面板） */
export interface SubAgentState {
  subagentId: string;
  parentToolCallId: string;
  expertId: string;
  expertName: string;
  prompt: string;
  stepId?: string;
  status: "running" | "ok" | "error" | "aborted";
  /** 累积文本（subagent_delta） */
  delta: string;
  tools: Array<{
    toolName: string;
    toolCallId: string;
    phase: "start" | "update" | "end";
    output?: unknown;
    error?: string;
  }>;
  text?: string;
  usage?: MessageUsage;
  error?: string;
}

/** workflow 单步运行状态 */
export interface WorkflowStepState {
  stepId: string;
  expertIds: string[];
  prompt: string;
  kind: "serial" | "parallel";
  status: "pending" | "running" | "ok" | "error";
  /** 该步骤下所有子 agent 的 subagentId（展开步骤面板用） */
  subagentIds: string[];
  output?: string;
  error?: string;
}

/** workflow 运行状态（workflow_* + subagent_* 事件驱动；当前任务仅存最新一次运行） */
export interface WorkflowRunState {
  runId: string;
  workflowId: string;
  name: string;
  status: "running" | "ok" | "error" | "aborted";
  steps: WorkflowStepState[];
  summary?: string;
  error?: string;
  usage?: MessageUsage;
  startedAt: number;
  finishedAt?: number;
}

// ────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────

interface SessionState {
  tasks: Task[];
  currentTaskId: string | null;
  workspaces: Workspace[];
  loaded: boolean;
  /** 待用于下一个新任务的工作空间 id（在主页选定，发送首条消息后建任务时消费） */
  pendingWorkspaceId: string | null;
  /** 正在加载历史的任务 id 集合（用于 ChatView 显示加载态） */
  hydratingIds: string[];
  /** 扩展状态：taskId -> extensionKey -> {value, lines, state} */
  extensionStates: Record<string, Record<string, ExtensionStatus>>;
  /** 预览项：taskId -> 最近结果列表（新在前，去重 + 上限 100） */
  previewItems: Record<string, PreviewItem[]>;
  /** 当前选中的预览项 id：taskId -> PreviewItem.id | null */
  previewSelection: Record<string, string | null>;
  addPreviewItems: (taskId: string, items: PreviewItem[]) => void;
  setPreviewSelection: (taskId: string, id: string | null) => void;
  /** 任务执行模式：taskId -> auto/manual/plan（输入框右下模式下拉选择） */
  modes: Record<string, ExecutionMode>;
  /** 主页选中的待应用模式：创建对话时应用到新任务 */
  pendingMode: ExecutionMode;
  setPendingMode: (mode: ExecutionMode) => void;
  /** 待人工确认的工具调用：taskId -> 队列 */
  pendingApprovals: Record<string, PendingToolApproval[]>;
  /** 本会话总是允许的工具：taskId -> 工具名集合 */
  alwaysAllowedTools: Record<string, string[]>;
  /** 对话内居中提示条：taskId -> 通知队列（extension_notify，4s 自动消失） */
  chatNotices: Record<string, ChatNotice[]>;
  pushChatNotice: (taskId: string, message: string, level?: ChatNotice["level"]) => void;
  dismissChatNotice: (taskId: string, id: string) => void;
  /** SDK 排队状态：taskId -> steer/followUp 队列（queue_update 事件；steer 供状态参考，队列区只渲染 followUp） */
  queues: Record<string, { steering: string[]; followUp: string[] }>;
  /** 渲染层自持排队记录：taskId -> FIFO 排队项（显示 + 交付插入 + 单项取消） */
  pendingFollowUps: Record<string, PendingFollowUpItem[]>;
  /** 单项取消进行中（clearQueue + 重发期间屏蔽 queue_update 交付判定，避免误交付） */
  clearingQueues: Record<string, boolean>;
  /** 更新队列状态 + 按 diff 交付已送达的 followUp（queue_update 事件） */
  handleQueueUpdate: (taskId: string, queue: { steering: string[]; followUp: string[] }) => void;
  enqueueFollowUpItem: (taskId: string, item: PendingFollowUpItem) => void;
  /** 从 pendingFollowUps 队首交付 count 条到对话（用 buildUserBlocks 重建用户消息） */
  deliverPendingFollowUps: (taskId: string, count: number) => void;
  /** 兜底交付：SDK followUp 队列已空但 pending 非空（空闲→prompt 无 queue_update 移除的路径 / message_start 前） */
  flushPendingFollowUps: (taskId: string) => void;
  /** 单项取消：clearQueue 后重发剩余项（followUp 带完整附件；steer 用对话内 steerReq 重发） */
  cancelFollowUpItem: (taskId: string, id: string) => Promise<void>;
  /** 转向交付时标记目标消息（steerTargetId）为「已转向」并清除目标（多次转向合并指向同一目标） */
  markSteerTargetRedirected: (taskId: string) => void;
  /** 清除最早一条「转向中」用户消息（steer 的 assistant turn 到达时） */
  clearOldestSteerPending: (taskId: string) => void;

  // 子 Agent / workflow 实时状态（subagent_* / workflow_* 事件驱动）
  subAgents: Record<string, Record<string, SubAgentState>>;
  workflowRuns: Record<string, WorkflowRunState>;
  startSubagent: (
    taskId: string,
    payload: {
      subagentId: string;
      parentToolCallId: string;
      expertId: string;
      expertName: string;
      prompt: string;
      stepId?: string;
    },
  ) => void;
  appendSubagentDelta: (taskId: string, subagentId: string, delta: string) => void;
  subagentTool: (
    taskId: string,
    subagentId: string,
    payload: {
      toolName: string;
      toolCallId: string;
      phase: "start" | "update" | "end";
      args?: unknown;
      output?: unknown;
      error?: string;
    },
  ) => void;
  endSubagent: (
    taskId: string,
    subagentId: string,
    payload: {
      status: "ok" | "error" | "aborted";
      text?: string;
      error?: string;
      usage?: MessageUsage;
    },
  ) => void;
  startWorkflow: (
    taskId: string,
    payload: { workflowId: string; name: string; stepCount: number },
  ) => void;
  workflowStepStart: (
    taskId: string,
    payload: { stepId: string; expertIds: string[]; prompt: string; kind: "serial" | "parallel" },
  ) => void;
  workflowStepEnd: (
    taskId: string,
    payload: { stepId: string; ok: boolean; output?: string; error?: string; usage?: MessageUsage },
  ) => void;
  endWorkflow: (
    taskId: string,
    payload: {
      status: "ok" | "error" | "aborted";
      summary?: string;
      error?: string;
      usage?: MessageUsage;
    },
  ) => void;
  /** 从持久化的团队运行记录恢复到渲染层（重开后追溯；记录 → SubAgentState/WorkflowRunState） */
  hydrateTeamRuns: (taskId: string, record: TeamRunRecord) => void;

  initFromBackend: (tasks: TaskMeta[], workspaces: Workspace[]) => void;
  upsertTask: (task: Task) => void;

  createTask: (req: CreateTaskRequest) => Promise<Task>;
  /** 从指定 assistant 条目分叉出新会话：建 Task → upsert → 选中（hydrate 加载分支历史） */
  branchTask: (taskId: string, entryId: string) => Promise<Task>;
  selectTask: (id: string) => void;
  hydrateTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  renameTask: (id: string, title: string) => void;
  openTaskDir: (id: string) => Promise<void>;

  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => Promise<void>;
  selectWorkspaceDir: () => Promise<string | null>;
  setPendingWorkspace: (id: string | null) => void;

  sendMessage: (
    taskId: string,
    text: string,
    attachments?: AttachmentRef[],
    channel?: "steer" | "followUp",
  ) => Promise<void>;
  setTaskProvider: (taskId: string, providerId: string) => Promise<void>;

  // 流式块操作
  startAssistantMessage: (taskId: string, sdkTimestamp?: number) => void;
  startBlock: (
    taskId: string,
    contentIndex: number,
    kind: ContentBlock["kind"],
    toolCallId?: string,
  ) => void;
  appendBlockDelta: (taskId: string, contentIndex: number, delta: string) => void;
  endBlock: (taskId: string, contentIndex: number, content?: string) => void;
  /** 兜底关闭当前流式消息内未闭合的 thinking/text 块（不碰 tool 块，工具在 message_end 后才执行） */
  closeContentBlocks: (taskId: string) => void;
  setToolCallInfo: (
    taskId: string,
    contentIndex: number,
    info: { toolCallId: string; name: string; arguments: unknown },
  ) => void;
  startToolExecution: (taskId: string, toolCallId: string, toolName: string, args: unknown) => void;
  appendToolDelta: (taskId: string, toolCallId: string, delta: string) => void;
  endToolExecution: (
    taskId: string,
    toolCallId: string,
    ok: boolean,
    output?: unknown,
    error?: string,
  ) => void;
  finalizeMessage: (taskId: string) => void;
  addErrorMessage: (taskId: string, message: string) => void;
  abortTask: (taskId: string) => Promise<void>;
  /** 标记当前流式消息为「已取消」（message_end stopReason==="aborted" 或合成 abort） */
  markMessageCancelled: (taskId: string) => void;
  /** 写入当前流式消息的元数据（message_end 的 usage/model/provider/stopReason） */
  setMessageMeta: (
    taskId: string,
    meta: { stopReason?: string; usage?: MessageUsage; model?: string; provider?: string },
  ) => void;
  /** 按 sdkTimestamp 匹配回填 entryId（message_entry_ids 事件，分支锚点） */
  markMessageEntryIds: (
    taskId: string,
    entries: Array<{ sdkTimestamp: number; entryId: string }>,
  ) => void;
  /** 赞/踩本地 UI 状态（不持久化，重复点同一按钮为取消） */
  setMessageFeedback: (taskId: string, messageId: string, feedback: "up" | "down" | null) => void;

  /** 更新某任务的扩展状态（extension_status 事件） */
  setExtensionStatus: (taskId: string, key: string, status: ExtensionStatus) => void;

  /** 设置某任务执行模式（本地 + 推送主进程） */
  setMode: (taskId: string, mode: ExecutionMode) => void;
  pushToolApproval: (taskId: string, approval: PendingToolApproval) => void;
  removeToolApproval: (taskId: string, requestId: string) => void;
  addAlwaysAllowedTool: (taskId: string, toolName: string) => void;
  isToolAlwaysAllowed: (taskId: string, toolName: string) => boolean;
}

/** 在 task 的流式消息中按 contentIndex 查找块索引 */
function findBlockIndex(msg: ChatMessage, contentIndex: number): number {
  return msg.blocks.findIndex((b) => b.id === String(contentIndex));
}

/** 不可变替换数组元素（避免 ES2023 Array.with） */
function replaceAt<T>(arr: readonly T[], idx: number, value: T): T[] {
  const next = arr.slice();
  next[idx] = value;
  return next;
}

/** 在 task 所有消息中按 toolCallId 查找 tool 块 */
function findToolBlock(
  task: Task,
  toolCallId: string,
): { msg: ChatMessage; blockIdx: number } | null {
  for (const msg of task.messages) {
    const idx = msg.blocks.findIndex((b) => b.kind === "tool" && b.toolCallId === toolCallId);
    if (idx >= 0) return { msg, blockIdx: idx };
  }
  return null;
}

function genId(): string {
  return crypto.randomUUID();
}

export const useSessionStore = create<SessionState>((set, get) => ({
  tasks: [],
  currentTaskId: null,
  workspaces: [],
  loaded: false,
  pendingWorkspaceId: null,
  hydratingIds: [],
  extensionStates: {},
  previewItems: {},
  previewSelection: {},
  modes: {},
  pendingMode: "auto",
  pendingApprovals: {},
  alwaysAllowedTools: {},
  chatNotices: {},
  queues: {},
  pendingFollowUps: {},
  clearingQueues: {},
  subAgents: {},
  workflowRuns: {},

  handleQueueUpdate: (taskId, queue) => {
    const prev = get().queues[taskId]?.followUp ?? [];
    set((state) => ({ queues: { ...state.queues, [taskId]: queue } }));
    // 单项取消重排期间（clearQueue 的 queue_update）不做交付判定，避免误交付被清项
    if (get().clearingQueues[taskId]) return;
    const delivered = diffDeliveredFollowUps(prev, queue.followUp);
    if (delivered > 0) get().deliverPendingFollowUps(taskId, delivered);
  },

  enqueueFollowUpItem: (taskId, item) =>
    set((state) => ({
      pendingFollowUps: {
        ...state.pendingFollowUps,
        [taskId]: [...(state.pendingFollowUps[taskId] ?? []), item],
      },
    })),

  deliverPendingFollowUps: (taskId, count) =>
    set((state) => {
      const pending = state.pendingFollowUps[taskId] ?? [];
      if (pending.length === 0) return state;
      const toDeliver = Math.min(count, pending.length);
      const delivered = pending.slice(0, toDeliver);
      const rest = pending.slice(toDeliver);
      return {
        pendingFollowUps: { ...state.pendingFollowUps, [taskId]: rest },
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? {
                ...t,
                messages: [
                  ...t.messages,
                  ...delivered.map(
                    (item): ChatMessage => ({
                      id: item.id,
                      role: "user",
                      blocks: buildUserBlocks(item.text, item.attachments),
                      timestamp: item.createdAt,
                    }),
                  ),
                ],
                updatedAt: new Date().toISOString(),
              }
            : t,
        ),
      };
    }),

  flushPendingFollowUps: (taskId) => {
    const state = get();
    const pending = state.pendingFollowUps[taskId] ?? [];
    if (pending.length === 0) return;
    // 交付信号：SDK followUp 队列已空（已交付，或空闲→prompt 从未入队）
    if ((state.queues[taskId]?.followUp ?? []).length > 0) return;
    get().deliverPendingFollowUps(taskId, pending.length);
  },

  cancelFollowUpItem: async (taskId, id) => {
    const pending = get().pendingFollowUps[taskId] ?? [];
    const target = pending.find((x) => x.id === id);
    if (!target) return;
    const remaining = pending.filter((x) => x.id !== id);
    set((s) => ({
      pendingFollowUps: { ...s.pendingFollowUps, [taskId]: remaining },
      clearingQueues: { ...s.clearingQueues, [taskId]: true },
    }));
    try {
      const cleared = await window.electronAPI.agent.clearQueue(taskId);
      // 重发剩余 followUp（带完整附件信息，避免清空后丢失）
      for (const item of remaining) {
        await window.electronAPI.agent.followUp({
          sessionId: taskId,
          text: item.text,
          providerId: item.providerId,
          attachments: item.attachments,
        });
      }
      // 重发被清掉的 steer（best-effort：用对话内 steer 用户消息存的 steerReq）
      if (cleared.steering.length > 0) {
        const steerReqs =
          get()
            .tasks.find((t) => t.id === taskId)
            ?.messages.filter(
              (m): m is ChatMessage & { steerReq: NonNullable<ChatMessage["steerReq"]> } =>
                m.role === "user" && Boolean(m.steerReq),
            ) ?? [];
        for (const text of cleared.steering) {
          const req = steerReqs.find((m) => m.steerReq.text === text)?.steerReq;
          await window.electronAPI.agent.steer({
            sessionId: taskId,
            text,
            providerId: req?.providerId,
            attachments: req?.attachments,
          });
        }
      }
    } catch (err) {
      console.error("[cancelFollowUpItem] 取消排队失败:", err);
    } finally {
      set((s) => ({ clearingQueues: { ...s.clearingQueues, [taskId]: false } }));
    }
  },

  markSteerTargetRedirected: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.steerTargetId) return t;
        const targetId = t.steerTargetId;
        return {
          ...t,
          steerTargetId: null,
          messages: t.messages.map((m) => (m.id === targetId ? { ...m, redirected: true } : m)),
        };
      }),
    })),

  clearOldestSteerPending: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        let cleared = false;
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (cleared || !m.steerPending) return m;
            cleared = true;
            return { ...m, steerPending: false };
          }),
        };
      }),
    })),

  // ── 子 Agent / workflow 状态（subagent_* / workflow_* 事件驱动） ──

  startSubagent: (taskId, payload) =>
    set((state) => ({
      subAgents: {
        ...state.subAgents,
        [taskId]: {
          ...(state.subAgents[taskId] ?? {}),
          [payload.subagentId]: {
            subagentId: payload.subagentId,
            parentToolCallId: payload.parentToolCallId,
            expertId: payload.expertId,
            expertName: payload.expertName,
            prompt: payload.prompt,
            stepId: payload.stepId,
            status: "running",
            delta: "",
            tools: [],
          },
        },
      },
    })),

  appendSubagentDelta: (taskId, subagentId, delta) =>
    set((state) => {
      const sub = state.subAgents[taskId]?.[subagentId];
      if (!sub) return state;
      return {
        subAgents: {
          ...state.subAgents,
          [taskId]: {
            ...state.subAgents[taskId],
            [subagentId]: { ...sub, delta: sub.delta + delta },
          },
        },
      };
    }),

  subagentTool: (taskId, subagentId, payload) =>
    set((state) => {
      const sub = state.subAgents[taskId]?.[subagentId];
      if (!sub) return state;
      // 按 toolCallId 升位更新（同一工具多次 phase 事件合并为一条），避免数组膨胀 + 数组索引 key
      const entry = {
        toolName: payload.toolName,
        toolCallId: payload.toolCallId,
        phase: payload.phase,
        output: payload.output,
        error: payload.error,
      };
      const existing = sub.tools.some((tool) => tool.toolCallId === payload.toolCallId);
      const tools = existing
        ? sub.tools.map((tool) =>
            tool.toolCallId === payload.toolCallId ? { ...tool, ...entry } : tool,
          )
        : [...sub.tools, entry];
      return {
        subAgents: {
          ...state.subAgents,
          [taskId]: {
            ...state.subAgents[taskId],
            [subagentId]: { ...sub, tools },
          },
        },
      };
    }),

  endSubagent: (taskId, subagentId, payload) =>
    set((state) => {
      const sub = state.subAgents[taskId]?.[subagentId];
      if (!sub) return state;
      return {
        subAgents: {
          ...state.subAgents,
          [taskId]: {
            ...state.subAgents[taskId],
            [subagentId]: {
              ...sub,
              status: payload.status,
              text: payload.text,
              error: payload.error,
              usage: payload.usage,
            },
          },
        },
      };
    }),

  startWorkflow: (taskId, payload) =>
    set((state) => ({
      workflowRuns: {
        ...state.workflowRuns,
        [taskId]: {
          runId: taskId,
          workflowId: payload.workflowId,
          name: payload.name,
          status: "running",
          steps: [],
          startedAt: Date.now(),
        },
      },
    })),

  workflowStepStart: (taskId, payload) =>
    set((state) => {
      const run = state.workflowRuns[taskId];
      if (!run) return state;
      const step: WorkflowStepState = {
        stepId: payload.stepId,
        expertIds: payload.expertIds,
        prompt: payload.prompt,
        kind: payload.kind,
        status: "running",
        subagentIds: [],
      };
      return {
        workflowRuns: {
          ...state.workflowRuns,
          [taskId]: { ...run, steps: [...run.steps, step] },
        },
      };
    }),

  workflowStepEnd: (taskId, payload) =>
    set((state) => {
      const run = state.workflowRuns[taskId];
      if (!run) return state;
      return {
        workflowRuns: {
          ...state.workflowRuns,
          [taskId]: {
            ...run,
            steps: run.steps.map((s) =>
              s.stepId === payload.stepId
                ? {
                    ...s,
                    status: payload.ok ? "ok" : "error",
                    output: payload.output,
                    error: payload.error,
                  }
                : s,
            ),
          },
        },
      };
    }),

  endWorkflow: (taskId, payload) =>
    set((state) => {
      const run = state.workflowRuns[taskId];
      if (!run) return state;
      return {
        workflowRuns: {
          ...state.workflowRuns,
          [taskId]: {
            ...run,
            status: payload.status,
            summary: payload.summary,
            error: payload.error,
            usage: payload.usage,
            finishedAt: Date.now(),
          },
        },
      };
    }),

  // 从持久化记录恢复：记录已存最终状态（delta 置空、text 用全文、status 用完成态）
  hydrateTeamRuns: (taskId, record) =>
    set((state) => {
      const subAgents: Record<string, SubAgentState> = {};
      for (const sub of record.subAgents) {
        subAgents[sub.subagentId] = {
          subagentId: sub.subagentId,
          parentToolCallId: sub.parentToolCallId,
          expertId: sub.expertId,
          expertName: sub.expertName,
          prompt: sub.prompt,
          stepId: sub.stepId,
          status: sub.status,
          delta: "",
          tools: sub.tools ?? [],
          text: sub.text,
          usage: sub.usage,
          error: sub.error,
        };
      }
      const workflowRun = record.workflowRun
        ? {
            runId: record.workflowRun.runId,
            workflowId: record.workflowRun.workflowId,
            name: record.workflowRun.name,
            status: record.workflowRun.status,
            steps: record.workflowRun.steps.map((s) => ({
              stepId: s.stepId,
              expertIds: s.expertIds,
              kind: s.kind,
              status: s.status,
              prompt: "",
              subagentIds: [],
              output: s.output,
              error: s.error,
            })),
            summary: record.workflowRun.summary,
            error: record.workflowRun.error,
            usage: record.workflowRun.usage,
            startedAt: record.workflowRun.startedAt,
            finishedAt: record.workflowRun.finishedAt,
          }
        : undefined;
      return {
        subAgents: { ...state.subAgents, [taskId]: subAgents },
        workflowRuns: {
          ...state.workflowRuns,
          ...(workflowRun ? { [taskId]: workflowRun } : {}),
        },
      };
    }),

  initFromBackend: (tasks, workspaces) =>
    set({
      // 按 updatedAt 倒序加载（最新优先）；updatedAt 相同时保持稳定顺序
      tasks: [...tasks]
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
        .map((t) => ({ ...t, messages: [] })),
      workspaces,
      loaded: true,
    }),

  setTaskProvider: async (taskId, providerId) => {
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, providerId, updatedAt: new Date().toISOString() } : t,
      ),
    }));
    await window.electronAPI.task.setProvider(taskId, providerId);
  },

  upsertTask: (task) =>
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.id === task.id);
      const tasks =
        idx >= 0 ? state.tasks.map((t) => (t.id === task.id ? task : t)) : [task, ...state.tasks];
      return { tasks };
    }),

  createTask: async (req) => {
    const meta = await window.electronAPI.task.create(req);
    const task: Task = {
      id: meta.id,
      title: meta.title,
      type: meta.type,
      mode: meta.mode,
      expertId: meta.expertId,
      teamId: meta.teamId,
      workspaceId: meta.workspaceId,
      workspacePath: meta.workspacePath,
      workDir: meta.workDir,
      providerId: meta.providerId,
      sessionDir: meta.sessionDir,
      messages: [],
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    set((state) => ({ tasks: [task, ...state.tasks], currentTaskId: task.id }));
    return task;
  },

  branchTask: async (taskId, entryId) => {
    const meta = await window.electronAPI.task.branch({ taskId, entryId });
    const task: Task = {
      id: meta.id,
      title: meta.title,
      type: meta.type,
      mode: meta.mode,
      expertId: meta.expertId,
      teamId: meta.teamId,
      workspaceId: meta.workspaceId,
      workspacePath: meta.workspacePath,
      workDir: meta.workDir,
      providerId: meta.providerId,
      sessionDir: meta.sessionDir,
      messages: [],
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    set((state) => ({ tasks: [task, ...state.tasks] }));
    // 选中新分支并加载其历史（hydrateTask 空消息即触发回放）
    get().selectTask(task.id);
    return task;
  },

  selectTask: (id) => {
    set({ currentTaskId: id });
    // 恢复已有任务的 AgentSession（重启后选中任务时）
    if (id) {
      void window.electronAPI.task.resume(id);
      // 加载历史消息（仅当尚未加载且非流式时）
      void get().hydrateTask(id);
    }
  },

  hydrateTask: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    // 已有消息或正在流式则不覆盖；已在加载中则跳过
    if (task.messages.length > 0 || task.isStreaming) return;
    if (get().hydratingIds.includes(id)) return;
    set((state) => ({ hydratingIds: [...state.hydratingIds, id] }));
    try {
      const history = await window.electronAPI.task.loadHistory(id);
      set((state) => ({
        tasks: state.tasks.map((t) =>
          t.id === id && t.messages.length === 0 && !t.isStreaming
            ? // 回放消息天然以条目 id 为消息 id（historyMapper），统一回填 entryId 供分支锚点
              { ...t, messages: history.map((m) => ({ ...m, entryId: m.id })) }
            : t,
        ),
        hydratingIds: state.hydratingIds.filter((x) => x !== id),
      }));
      // 恢复团队运行记录（子 agent / workflow 过程追溯）
      try {
        const runs = await window.electronAPI.team.getRuns(id);
        if (runs) get().hydrateTeamRuns(id, runs);
        // workflow 任务无会话 JSONL：用记录里的触发 prompt 重建用户消息，保证对话历史可见
        const prompt = runs?.workflowRun?.prompt;
        if (prompt) {
          set((state) => ({
            tasks: state.tasks.map((t) =>
              t.id === id && t.messages.length === 0
                ? {
                    ...t,
                    messages: [
                      {
                        id: `wf-prompt-${id}`,
                        role: "user",
                        blocks: [
                          { id: `wf-prompt-${id}-b`, kind: "text", content: prompt, done: true },
                        ],
                        timestamp: runs.workflowRun?.startedAt ?? Date.now(),
                      },
                    ],
                  }
                : t,
            ),
          }));
        }
      } catch (err) {
        console.warn("[hydrateTask] 团队运行记录恢复失败:", err);
      }
    } catch (err) {
      console.error("[hydrateTask] 加载历史失败:", err);
      set((state) => ({ hydratingIds: state.hydratingIds.filter((x) => x !== id) }));
    }
  },

  deleteTask: async (id) => {
    await window.electronAPI.task.delete(id);
    set((state) => {
      const { [id]: _mode, ...modes } = state.modes;
      const { [id]: _pa, ...pendingApprovals } = state.pendingApprovals;
      const { [id]: _aa, ...alwaysAllowedTools } = state.alwaysAllowedTools;
      const { [id]: _es, ...extensionStates } = state.extensionStates;
      const { [id]: _pi, ...previewItems } = state.previewItems;
      const { [id]: _ps, ...previewSelection } = state.previewSelection;
      const { [id]: _q, ...queues } = state.queues;
      const { [id]: _pf, ...pendingFollowUps } = state.pendingFollowUps;
      const { [id]: _cq, ...clearingQueues } = state.clearingQueues;
      const { [id]: _sa, ...subAgents } = state.subAgents;
      const { [id]: _wr, ...workflowRuns } = state.workflowRuns;
      return {
        tasks: state.tasks.filter((t) => t.id !== id),
        currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
        hydratingIds: state.hydratingIds.filter((x) => x !== id),
        modes,
        pendingApprovals,
        alwaysAllowedTools,
        extensionStates,
        previewItems,
        previewSelection,
        queues,
        pendingFollowUps,
        clearingQueues,
        subAgents,
        workflowRuns,
      };
    });
  },

  renameTask: (id, title) => {
    window.electronAPI.task.rename(id, title).catch((e) => console.error("[renameTask]", e));
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, title, updatedAt: new Date().toISOString() } : t,
      ),
    }));
  },

  openTaskDir: (id) => window.electronAPI.task.openDir(id),

  addWorkspace: (ws) => set((state) => ({ workspaces: [...state.workspaces, ws] })),
  removeWorkspace: async (id) => {
    // 主进程级联删除该空间下所有任务及其会话记录（空间磁盘目录保留）
    await window.electronAPI.workspace.remove(id);
    set((state) => {
      const removedIds = new Set(state.tasks.filter((t) => t.workspaceId === id).map((t) => t.id));
      return {
        workspaces: state.workspaces.filter((w) => w.id !== id),
        tasks: state.tasks.filter((t) => !removedIds.has(t.id)),
        currentTaskId:
          state.currentTaskId && removedIds.has(state.currentTaskId) ? null : state.currentTaskId,
        pendingWorkspaceId: state.pendingWorkspaceId === id ? null : state.pendingWorkspaceId,
        hydratingIds: state.hydratingIds.filter((x) => !removedIds.has(x)),
      };
    });
  },
  selectWorkspaceDir: () => window.electronAPI.workspace.selectDir(),
  setPendingWorkspace: (id) => set({ pendingWorkspaceId: id }),

  sendMessage: async (taskId, text, attachments, channel) => {
    const existing = get().tasks.find((t) => t.id === taskId);
    const providerId = existing?.providerId;

    // 排队：驻留队列区，不进对话（交付时经 queue_update diff / message_start 兜底插入）
    if (channel === "followUp") {
      const item: PendingFollowUpItem = {
        id: genId(),
        text,
        attachments: attachments ?? [],
        providerId,
        createdAt: Date.now(),
      };
      get().enqueueFollowUpItem(taskId, item);
      try {
        await window.electronAPI.agent.followUp({
          sessionId: taskId,
          text,
          providerId,
          attachments,
        });
      } catch (err) {
        get().addErrorMessage(taskId, err instanceof Error ? err.message : String(err));
        // 发送失败：移除排队项，避免队列区残留
        set((s) => ({
          pendingFollowUps: {
            ...s.pendingFollowUps,
            [taskId]: (s.pendingFollowUps[taskId] ?? []).filter((x) => x.id !== item.id),
          },
        }));
      }
      return;
    }

    // steer / 普通 prompt：用户消息乐观进对话
    const blocks: ContentBlock[] = buildUserBlocks(text, attachments ?? []);
    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      blocks,
      timestamp: Date.now(),
      // 转向：标记「转向中」（交付前），存 steerReq（单项取消重发用）
      ...(channel === "steer"
        ? {
            steerPending: true,
            steerReq: { text, providerId, attachments: attachments ?? [] },
          }
        : {}),
    };
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId
          ? {
              ...t,
              messages: [...t.messages, userMsg],
              updatedAt: new Date().toISOString(),
              // 等待首个 assistant 消息期间置 pending（首 token 前渲染「运行中」指示）；
              // 流式中发送（steer）不置，避免与在途流的指示重复
              pending: t.isStreaming ? t.pending : true,
              // 转向目标：首次转向捕获当前在途消息；同一在途 turn 内多次转向合并指向同一目标
              // （避免第二次转向把第一次的响应误标「已转向」）
              steerTargetId:
                channel === "steer"
                  ? (t.steerTargetId ?? t.streamMessageId ?? null)
                  : t.steerTargetId,
            }
          : t,
      ),
    }));
    try {
      const req = { sessionId: taskId, text, providerId, attachments };
      if (channel === "steer") await window.electronAPI.agent.steer(req);
      else await window.electronAPI.agent.prompt(req);
    } catch (err) {
      // 主进程通常已通过 error 事件报错；此处兜底，避免 unhandled rejection
      get().addErrorMessage(taskId, err instanceof Error ? err.message : String(err));
    }
    // 注意：不再 finally finalizeMessage —— 原生 steer 非阻塞立即返回，
    // finally 会提前结算在途消息、丢 usage；agent_end/agent_settled 已负责 finalize
  },

  // ── 流式块操作 ────────────────────────────

  startAssistantMessage: (taskId, sdkTimestamp) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const msgId = genId();
        const msg: ChatMessage = {
          id: msgId,
          role: "assistant",
          blocks: [],
          timestamp: Date.now(),
          isStreaming: true,
          sdkTimestamp,
        };
        return {
          ...t,
          messages: [...t.messages, msg],
          isStreaming: true,
          streamMessageId: msgId,
          // 首个 assistant 消息到达，结束 pending（「运行中」指示移交组内流式渲染）
          pending: false,
        };
      }),
    })),

  startBlock: (taskId, contentIndex, kind, toolCallId) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.streamMessageId) return t;
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.id !== t.streamMessageId) return m;
            const block: ContentBlock =
              kind === "tool"
                ? {
                    id: String(contentIndex),
                    kind: "tool",
                    toolCallId: toolCallId ?? genId(),
                    toolName: "",
                    args: undefined,
                    argDelta: "",
                    status: "calling",
                    output: undefined,
                    outputDelta: "",
                    done: false,
                  }
                : kind === "thinking"
                  ? { id: String(contentIndex), kind: "thinking", content: "", done: false }
                  : kind === "file"
                    ? { id: String(contentIndex), kind: "file", name: "", done: false }
                    : { id: String(contentIndex), kind: "text", content: "", done: false };
            return { ...m, blocks: [...m.blocks, block] };
          }),
        };
      }),
    })),

  appendBlockDelta: (taskId, contentIndex, delta) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.streamMessageId) return t;
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.id !== t.streamMessageId) return m;
            const idx = findBlockIndex(m, contentIndex);
            if (idx < 0) return m;
            const block = m.blocks[idx];
            if (!block) return m;
            if (block.kind === "tool") {
              return {
                ...m,
                blocks: replaceAt(m.blocks, idx, { ...block, argDelta: block.argDelta + delta }),
              };
            }
            // file 块不参与流式 delta（仅在发送时一次性创建）
            if (block.kind !== "text" && block.kind !== "thinking") return m;
            return {
              ...m,
              blocks: replaceAt(m.blocks, idx, { ...block, content: block.content + delta }),
            };
          }),
        };
      }),
    })),

  endBlock: (taskId, contentIndex, content) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.streamMessageId) return t;
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.id !== t.streamMessageId) return m;
            const idx = findBlockIndex(m, contentIndex);
            if (idx < 0) return m;
            const block = m.blocks[idx];
            if (!block) return m;
            const updated =
              content !== undefined && block.kind !== "tool"
                ? { ...block, content, done: true }
                : { ...block, done: true };
            return { ...m, blocks: replaceAt(m.blocks, idx, updated) };
          }),
        };
      }),
    })),

  closeContentBlocks: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.streamMessageId) return t;
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.id !== t.streamMessageId) return m;
            // 仅关闭 thinking/text；tool 块由 tool_execution_end 负责，执行在 message_end 之后
            if (!m.blocks.some((b) => !b.done && b.kind !== "tool")) return m;
            return {
              ...m,
              blocks: m.blocks.map((b) => (b.done || b.kind === "tool" ? b : { ...b, done: true })),
            };
          }),
        };
      }),
    })),

  setToolCallInfo: (taskId, contentIndex, info) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.streamMessageId) return t;
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.id !== t.streamMessageId) return m;
            const idx = findBlockIndex(m, contentIndex);
            if (idx < 0) return m;
            const block = m.blocks[idx];
            if (block?.kind !== "tool") return m;
            const updated = {
              ...block,
              toolCallId: info.toolCallId,
              toolName: info.name,
              args: info.arguments,
            };
            return { ...m, blocks: replaceAt(m.blocks, idx, updated) };
          }),
        };
      }),
    })),

  startToolExecution: (taskId, toolCallId, toolName, args) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const found = findToolBlock(t, toolCallId);
        if (!found) return t;
        const { msg, blockIdx } = found;
        const block = msg.blocks[blockIdx];
        if (block?.kind !== "tool") return t;
        const updated = { ...block, toolName, args, status: "running" as const };
        return {
          ...t,
          messages: t.messages.map((m) =>
            m.id === msg.id ? { ...m, blocks: replaceAt(m.blocks, blockIdx, updated) } : m,
          ),
        };
      }),
    })),

  appendToolDelta: (taskId, toolCallId, delta) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const found = findToolBlock(t, toolCallId);
        if (!found) return t;
        const { msg, blockIdx } = found;
        const block = msg.blocks[blockIdx];
        if (block?.kind !== "tool") return t;
        const updated = { ...block, outputDelta: block.outputDelta + delta };
        return {
          ...t,
          messages: t.messages.map((m) =>
            m.id === msg.id ? { ...m, blocks: replaceAt(m.blocks, blockIdx, updated) } : m,
          ),
        };
      }),
    })),

  endToolExecution: (taskId, toolCallId, ok, output, error) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const found = findToolBlock(t, toolCallId);
        if (!found) return t;
        const { msg, blockIdx } = found;
        const block = msg.blocks[blockIdx];
        if (block?.kind !== "tool") return t;
        const updated = {
          ...block,
          status: (ok ? "success" : "error") as "success" | "error",
          output,
          error,
          done: true,
        };
        return {
          ...t,
          messages: t.messages.map((m) =>
            m.id === msg.id ? { ...m, blocks: replaceAt(m.blocks, blockIdx, updated) } : m,
          ),
        };
      }),
    })),

  finalizeMessage: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const aborting = Boolean(t.abortRequested);
        return {
          ...t,
          // agent 消息结算（agent_end/agent_settled）：翻转消息级 isStreaming、清流式指针、
          // 移除空消息。同时兜底关闭所有未闭合块--块的结束状态优先由各类型 end 事件负责
          // （thinking_end/text_end -> endBlock；tool -> tool_execution_end），但 SDK 不保证
          // 一定发出 *_end（pi-ai 协议：流以 done/error 终止，中途 *_end 可能丢失），
          // 故在此兜底，避免思考跳动点/文本光标永不消失。
          messages: t.messages
            .map((m) => {
              if (m.isStreaming) {
                const finalized = {
                  ...m,
                  isStreaming: false,
                  endedAt: Date.now(),
                  blocks: m.blocks.map((b) => (b.done ? b : { ...b, done: true })),
                };
                // 用户已请求中止 → 在途消息呈现「已取消」（不折叠为「任务已完成」）；
                // 与 message_end stopReason="aborted" 路径互补，兜底工具执行中 abort 不回发该事件
                return aborting ? { ...finalized, cancelled: true } : finalized;
              }
              // 非流式消息：兜底清除残留「转向中」（stranded steer 未交付时防 chip 卡死）
              return m.steerPending ? { ...m, steerPending: false } : m;
            })
            // 保留「已取消但空块」的消息：abort 早于首个 block（或跨 turn 的第二个空 turn）
            // 时若不保留，分组会回退到上一 turn 而误显「任务已完成」卡
            .filter(
              (m) => !(m.blocks.length === 0 && !m.errorMessage && !m.isStreaming && !m.cancelled),
            ),
          isStreaming: false,
          streamMessageId: null,
          pending: false,
          abortRequested: false,
          steerTargetId: null,
        };
      }),
    })),

  addErrorMessage: (taskId, message) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        // 若有流式消息，标记结束并附错误；否则追加错误消息
        if (t.streamMessageId) {
          return {
            ...t,
            // error/abort 时 SDK 跳过 per-block *_end（只发 error），故在此把未闭合块置 done
            messages: t.messages.map((m) =>
              m.id === t.streamMessageId
                ? {
                    ...m,
                    isStreaming: false,
                    endedAt: Date.now(),
                    errorMessage: message,
                    blocks: m.blocks.map((b) => ({ ...b, done: true })),
                  }
                : m,
            ),
            isStreaming: false,
            streamMessageId: null,
            pending: false,
          };
        }
        // 无流式消息：仅当上一条不是错误消息时才追加，避免同一失败被 SDK error 事件
        // 与 session.prompt() reject 双重上报产生重复错误气泡
        const last = t.messages[t.messages.length - 1];
        if (last?.errorMessage) return t.pending ? { ...t, pending: false } : t;
        const errMsg: ChatMessage = {
          id: genId(),
          role: "assistant",
          blocks: [],
          timestamp: Date.now(),
          errorMessage: message,
        };
        return { ...t, messages: [...t.messages, errMsg], pending: false };
      }),
    })),

  abortTask: async (taskId) => {
    // 记录中止意图：finalizeMessage 时据此把在途流式消息置「已取消」，
    // 兜底 SDK 工具执行中 abort 不回发 stopReason="aborted" 的 message_end 的情况
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, abortRequested: true } : t)),
    }));
    await window.electronAPI.agent.abort(taskId);
  },

  markMessageCancelled: (taskId) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.streamMessageId) return t;
        return {
          ...t,
          messages: t.messages.map((m) =>
            m.id === t.streamMessageId ? { ...m, cancelled: true } : m,
          ),
        };
      }),
    })),

  setMessageMeta: (taskId, meta) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId || !t.streamMessageId) return t;
        return {
          ...t,
          messages: t.messages.map((m) =>
            m.id === t.streamMessageId
              ? {
                  ...m,
                  stopReason: meta.stopReason ?? m.stopReason,
                  usage: meta.usage ?? m.usage,
                  model: meta.model ?? m.model,
                  provider: meta.provider ?? m.provider,
                }
              : m,
          ),
        };
      }),
    })),

  markMessageEntryIds: (taskId, entries) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          messages: t.messages.map((m) => {
            if (m.role !== "assistant" || m.entryId || m.sdkTimestamp === undefined) return m;
            const hit = entries.find((e) => e.sdkTimestamp === m.sdkTimestamp);
            return hit ? { ...m, entryId: hit.entryId } : m;
          }),
        };
      }),
    })),

  setMessageFeedback: (taskId, messageId, feedback) =>
    set((state) => ({
      tasks: state.tasks.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          messages: t.messages.map((m) => (m.id === messageId ? { ...m, feedback } : m)),
        };
      }),
    })),

  setExtensionStatus: (taskId, key, status) =>
    set((state) => ({
      extensionStates: {
        ...state.extensionStates,
        [taskId]: { ...state.extensionStates[taskId], [key]: status },
      },
    })),

  addPreviewItems: (taskId, items) =>
    set((state) => {
      const existing = state.previewItems[taskId] ?? [];
      // 按 absPath 去重（同一文件不重复入条），新项前置、封顶 100
      const seen = new Set(existing.map((i) => i.absPath));
      const fresh = items.filter((i) => !seen.has(i.absPath));
      if (fresh.length === 0) return state;
      return {
        previewItems: {
          ...state.previewItems,
          [taskId]: [...fresh, ...existing].slice(0, 100),
        },
      };
    }),

  setPreviewSelection: (taskId, id) =>
    set((state) => ({
      previewSelection: { ...state.previewSelection, [taskId]: id },
    })),

  setMode: (taskId, mode) => {
    set((state) => ({ modes: { ...state.modes, [taskId]: mode } }));
    void window.electronAPI.agent.setMode({ taskId, mode });
  },

  setPendingMode: (mode) => set({ pendingMode: mode }),

  pushToolApproval: (taskId, approval) =>
    set((state) => ({
      pendingApprovals: {
        ...state.pendingApprovals,
        [taskId]: [...(state.pendingApprovals[taskId] ?? []), approval],
      },
    })),

  removeToolApproval: (taskId, requestId) =>
    set((state) => ({
      pendingApprovals: {
        ...state.pendingApprovals,
        [taskId]: (state.pendingApprovals[taskId] ?? []).filter((a) => a.requestId !== requestId),
      },
    })),

  addAlwaysAllowedTool: (taskId, toolName) =>
    set((state) => ({
      alwaysAllowedTools: {
        ...state.alwaysAllowedTools,
        [taskId]: Array.from(new Set([...(state.alwaysAllowedTools[taskId] ?? []), toolName])),
      },
    })),

  isToolAlwaysAllowed: (taskId, toolName) =>
    (get().alwaysAllowedTools[taskId] ?? []).includes(toolName),

  pushChatNotice: (taskId, message, level) => {
    const id = crypto.randomUUID();
    set((s) => ({
      chatNotices: {
        ...s.chatNotices,
        [taskId]: [...(s.chatNotices[taskId] ?? []), { id, message, level: level ?? "info" }],
      },
    }));
    setTimeout(() => {
      if (get().chatNotices[taskId]?.some((n) => n.id === id)) {
        set((s) => ({
          chatNotices: {
            ...s.chatNotices,
            [taskId]: (s.chatNotices[taskId] ?? []).filter((n) => n.id !== id),
          },
        }));
      }
    }, 4000);
  },

  dismissChatNotice: (taskId, id) =>
    set((s) => ({
      chatNotices: {
        ...s.chatNotices,
        [taskId]: (s.chatNotices[taskId] ?? []).filter((n) => n.id !== id),
      },
    })),
}));
