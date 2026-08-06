import type { CreateTaskRequest, TaskMeta, Workspace } from "@everybuddy/ipc-contract";
import { create } from "zustand";

// ────────────────────────────────────────────────
// 内容块与消息模型（见 §0.4 卡片化消息模型）
// ────────────────────────────────────────────────

export interface ThinkingBlock {
  id: string;
  kind: "thinking";
  content: string;
  done: boolean;
}

export interface TextBlock {
  id: string;
  kind: "text";
  content: string;
  done: boolean;
}

export interface ToolBlock {
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

export type ContentBlock = ThinkingBlock | TextBlock | ToolBlock;

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  blocks: ContentBlock[];
  timestamp: number;
  isStreaming?: boolean;
  errorMessage?: string;
}

export interface Task {
  id: string;
  title: string;
  type: "temp" | "workspace";
  workspaceId?: string;
  workspacePath?: string;
  providerId?: string;
  sessionDir: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  isStreaming?: boolean;
  /** 当前流式 assistant 消息 id */
  streamMessageId?: string | null;
}

// ────────────────────────────────────────────────
// Store
// ────────────────────────────────────────────────

interface SessionState {
  tasks: Task[];
  currentTaskId: string | null;
  workspaces: Workspace[];
  loaded: boolean;

  initFromBackend: (tasks: TaskMeta[], workspaces: Workspace[]) => void;
  upsertTask: (task: Task) => void;

  createTask: (req: CreateTaskRequest) => Promise<Task>;
  selectTask: (id: string) => void;
  deleteTask: (id: string) => Promise<void>;
  renameTask: (id: string, title: string) => void;
  openTaskDir: (id: string) => Promise<void>;

  addWorkspace: (ws: Workspace) => void;
  removeWorkspace: (id: string) => void;
  selectWorkspaceDir: () => Promise<string | null>;

  sendMessage: (taskId: string, text: string) => Promise<void>;
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

  initFromBackend: (tasks, workspaces) =>
    set({
      tasks: tasks.map((t) => ({ ...t, messages: [] })),
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
    if (id) void window.electronAPI.task.resume(id);
  },

  deleteTask: async (id) => {
    await window.electronAPI.task.delete(id);
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id),
      currentTaskId: state.currentTaskId === id ? null : state.currentTaskId,
    }));
  },

  renameTask: (id, title) => {
    void window.electronAPI.task.rename(id, title);
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === id ? { ...t, title, updatedAt: new Date().toISOString() } : t,
      ),
    }));
  },

  openTaskDir: (id) => window.electronAPI.task.openDir(id),

  addWorkspace: (ws) => set((state) => ({ workspaces: [...state.workspaces, ws] })),
  removeWorkspace: (id) =>
    set((state) => ({ workspaces: state.workspaces.filter((w) => w.id !== id) })),
  selectWorkspaceDir: () => window.electronAPI.workspace.selectDir(),

  sendMessage: async (taskId, text) => {
    const userMsg: ChatMessage = {
      id: genId(),
      role: "user",
      blocks: [{ id: "0", kind: "text", content: text, done: true }],
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
      await window.electronAPI.agent.prompt({ sessionId: taskId, text, providerId });
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
          // agent 消息结算（agent_end/agent_settled）：只翻转消息级 isStreaming、清流式指针、
          // 移除空消息。不碰 block.done——块的结束状态由各类型 end 事件负责
          // （thinking_end/text_end -> endBlock；tool -> tool_execution_end）。
          messages: t.messages
            .map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
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
}));
