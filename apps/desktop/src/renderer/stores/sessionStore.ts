import type {
  AttachmentRef,
  CreateTaskRequest,
  ExecutionMode,
  HistoryBlock,
  HistoryMessage,
  HistoryTextBlock,
  HistoryThinkingBlock,
  HistoryToolBlock,
  TaskMeta,
  Workspace,
} from "@everybuddy/ipc-contract";
import { create } from "zustand";

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
}

export interface Task extends TaskMeta {
  messages: ChatMessage[];
  isStreaming?: boolean;
  /** 当前流式 assistant 消息 id */
  streamMessageId?: string | null;
}

/** 扩展状态（extension_status 事件负载；state 为扩展自有状态机，如 plan-mode 的 off/plan/ready/executing） */
export interface ExtensionStatus {
  value?: string;
  lines?: string[];
  state?: string;
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

  initFromBackend: (tasks: TaskMeta[], workspaces: Workspace[]) => void;
  upsertTask: (task: Task) => void;

  createTask: (req: CreateTaskRequest) => Promise<Task>;
  selectTask: (id: string) => void;
  hydrateTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  renameTask: (id: string, title: string) => void;
  openTaskDir: (id: string) => Promise<void>;

  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => Promise<void>;
  selectWorkspaceDir: () => Promise<string | null>;
  setPendingWorkspace: (id: string | null) => void;

  sendMessage: (taskId: string, text: string, attachments?: AttachmentRef[]) => Promise<void>;
  setTaskProvider: (taskId: string, providerId: string) => Promise<void>;

  // 流式块操作
  startAssistantMessage: (taskId: string) => void;
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
  modes: {},
  pendingMode: "auto",
  pendingApprovals: {},
  alwaysAllowedTools: {},
  chatNotices: {},

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
            ? { ...t, messages: history }
            : t,
        ),
        hydratingIds: state.hydratingIds.filter((x) => x !== id),
      }));
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
      return {
        tasks: state.tasks.filter((t) => t.id !== id),
        currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
        hydratingIds: state.hydratingIds.filter((x) => x !== id),
        modes,
        pendingApprovals,
        alwaysAllowedTools,
        extensionStates,
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

  sendMessage: async (taskId, text, attachments) => {
    // 用户消息 blocks：附件 chips 在前，文本块在后（可仅有附件无文本）
    const blocks: ContentBlock[] = (attachments ?? []).map((a, i) => ({
      id: String(i),
      kind: "file",
      name: a.name,
      size: a.size,
      done: true,
    }));
    if (text.trim()) {
      blocks.push({ id: String(blocks.length), kind: "text", content: text, done: true });
    }
    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      blocks,
      timestamp: Date.now(),
    };
    let providerId: string | undefined;
    set((state) => {
      const task = state.tasks.find((t) => t.id === taskId);
      providerId = task?.providerId;
      return {
        tasks: state.tasks.map((t) =>
          t.id === taskId
            ? { ...t, messages: [...t.messages, userMsg], updatedAt: new Date().toISOString() }
            : t,
        ),
      };
    });
    try {
      await window.electronAPI.agent.prompt({ sessionId: taskId, text, providerId, attachments });
    } catch (err) {
      // 主进程通常已通过 error 事件报错；此处兜底，避免 unhandled rejection
      get().addErrorMessage(taskId, err instanceof Error ? err.message : String(err));
    } finally {
      // 兜底：确保 agent 消息结束（即便 SDK 未发 agent_end/agent_settled）
      get().finalizeMessage(taskId);
    }
  },

  // ── 流式块操作 ────────────────────────────

  startAssistantMessage: (taskId) =>
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
        };
        return {
          ...t,
          messages: [...t.messages, msg],
          isStreaming: true,
          streamMessageId: msgId,
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
        return {
          ...t,
          // agent 消息结算（agent_end/agent_settled）：翻转消息级 isStreaming、清流式指针、
          // 移除空消息。同时兜底关闭所有未闭合块--块的结束状态优先由各类型 end 事件负责
          // （thinking_end/text_end -> endBlock；tool -> tool_execution_end），但 SDK 不保证
          // 一定发出 *_end（pi-ai 协议：流以 done/error 终止，中途 *_end 可能丢失），
          // 故在此兜底，避免思考跳动点/文本光标永不消失。
          messages: t.messages
            .map((m) =>
              m.isStreaming
                ? {
                    ...m,
                    isStreaming: false,
                    blocks: m.blocks.map((b) => (b.done ? b : { ...b, done: true })),
                  }
                : m,
            )
            .filter((m) => !(m.blocks.length === 0 && !m.errorMessage && !m.isStreaming)),
          isStreaming: false,
          streamMessageId: null,
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
                    errorMessage: message,
                    blocks: m.blocks.map((b) => ({ ...b, done: true })),
                  }
                : m,
            ),
            isStreaming: false,
            streamMessageId: null,
          };
        }
        // 无流式消息：仅当上一条不是错误消息时才追加，避免同一失败被 SDK error 事件
        // 与 session.prompt() reject 双重上报产生重复错误气泡
        const last = t.messages[t.messages.length - 1];
        if (last?.errorMessage) return t;
        const errMsg: ChatMessage = {
          id: genId(),
          role: "assistant",
          blocks: [],
          timestamp: Date.now(),
          errorMessage: message,
        };
        return { ...t, messages: [...t.messages, errMsg] };
      }),
    })),

  abortTask: async (taskId) => {
    await window.electronAPI.agent.abort(taskId);
  },

  setExtensionStatus: (taskId, key, status) =>
    set((state) => ({
      extensionStates: {
        ...state.extensionStates,
        [taskId]: { ...state.extensionStates[taskId], [key]: status },
      },
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
        [taskId]: [
          ...(s.chatNotices[taskId] ?? []),
          { id, message, level: level ?? "info" },
        ],
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
