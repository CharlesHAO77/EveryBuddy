import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type ChatMessage, useSessionStore } from "../stores/sessionStore";
import { type CategoryId, useUIStore } from "../stores/uiStore";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconFolder,
  IconMic,
  IconPlus,
  IconStop,
  IconX,
} from "./icons";
import { AssistantGroup, MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";

/* ── Model Selector Helpers ───────────────────── */

function useDefaultProviderId() {
  return useUIStore((s) => {
    if (s.currentModelId) return s.currentModelId;
    return s.models[0]?.id ?? null;
  });
}

type MessageGroup =
  | { kind: "user" | "error"; messages: ChatMessage[] }
  | { kind: "assistant"; messages: ChatMessage[] };

/** 将连续的 assistant 消息合并为一组（一个 agent 消息含多个 turn），user/错误消息独立成组 */
function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      groups.push({ kind: "user", messages: [msg] });
    } else if (msg.errorMessage) {
      groups.push({ kind: "error", messages: [msg] });
    } else {
      const last = groups[groups.length - 1];
      if (last?.kind === "assistant") {
        last.messages.push(msg);
      } else {
        groups.push({ kind: "assistant", messages: [msg] });
      }
    }
  }
  return groups;
}

/* ── Data ────────────────────────────────────── */

const modes = [
  { id: "daily" as CategoryId, label: "日常办公" },
  { id: "coding" as CategoryId, label: "代码开发" },
];

const dailyTags = [{ id: "ppt", label: "PPT生成" }];

const codingTags = [
  { id: "daily-dev", label: "日常开发" },
  { id: "website", label: "网站开发" },
  { id: "agent", label: "Agent应用" },
  { id: "skill", label: "Skill开发" },
  { id: "cicd", label: "CI/CD" },
  { id: "docs", label: "文档" },
];

/* ── MainView Component ──────────────────────── */

export function MainView() {
  const currentTaskId = useSessionStore((s) => s.currentTaskId);

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-paper">
      {currentTaskId ? <ChatView taskId={currentTaskId} /> : <WelcomeView />}
    </main>
  );
}

/* ── Workspace Selector ─────────────────────── */

/**
 * WorkspaceSelector - 主页「选择工作空间」下拉菜单。
 * 选项：已有空间 / 指定文件夹（注册为空间）/ 新建空间（输入名称）/ 无工作空间（临时任务）。
 * 选定后写入 sessionStore.pendingWorkspaceId，发送首条消息时据此创建空间任务。
 */
function WorkspaceSelector() {
  const workspaces = useSessionStore((s) => s.workspaces);
  const pendingWorkspaceId = useSessionStore((s) => s.pendingWorkspaceId);
  const setPendingWorkspace = useSessionStore((s) => s.setPendingWorkspace);
  const addWorkspace = useSessionStore((s) => s.addWorkspace);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = workspaces.find((w) => w.id === pendingWorkspaceId) ?? null;
  const label = selected ? selected.name : "选择工作空间";

  const handlePickFolder = async () => {
    const dir = await window.electronAPI.workspace.selectDir();
    if (!dir) return;
    const folderName = dir.split("/").pop() || dir;
    const ws = await window.electronAPI.workspace.create(folderName, dir);
    addWorkspace(ws);
    setPendingWorkspace(ws.id);
    setOpen(false);
  };

  const handleCreateNamed = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ws = await window.electronAPI.workspace.createNamed(trimmed);
    addWorkspace(ws);
    setPendingWorkspace(ws.id);
    setName("");
    setCreating(false);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-[4px] text-[12px] text-ink-3 transition hover:text-ink-2"
      >
        {label}
        <IconChevronDown size={10} strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-[6px] w-[220px] rounded-m border border-line bg-card py-[6px] shadow-pop">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => {
                setPendingWorkspace(ws.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] transition hover:bg-hover ${
                ws.id === pendingWorkspaceId ? "text-ink" : "text-ink-2"
              }`}
            >
              <IconFolder size={14} className="text-ink-3" />
              <span className="flex-1 truncate">{ws.name}</span>
              {ws.id === pendingWorkspaceId && (
                <IconCheck size={12} strokeWidth={2.5} className="text-accent" />
              )}
            </button>
          ))}

          <div className="my-[4px] border-t border-line" />

          <button
            type="button"
            onClick={handlePickFolder}
            className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] text-ink-2 transition hover:bg-hover"
          >
            <IconFolder size={14} className="text-ink-3" />
            指定文件夹
          </button>

          {creating ? (
            <div className="px-[10px] py-[6px]">
              <input
                type="text"
                value={name}
                // biome-ignore lint/a11y/noAutofocus: 点「新建空间」后需立即聚焦名称输入
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreateNamed();
                  }
                  if (e.key === "Escape") {
                    setCreating(false);
                    setName("");
                  }
                }}
                placeholder="空间名称"
                className="w-full rounded-s border border-line bg-card px-[8px] py-[5px] text-[13px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
              <div className="mt-[6px] flex gap-[6px]">
                <button
                  type="button"
                  onClick={() => void handleCreateNamed()}
                  disabled={!name.trim()}
                  className="rounded-s bg-accent px-[10px] py-[4px] text-[12px] text-white transition hover:bg-accent-strong disabled:opacity-30"
                >
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setName("");
                  }}
                  className="rounded-s px-[10px] py-[4px] text-[12px] text-ink-3 transition hover:bg-hover"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] text-ink-2 transition hover:bg-hover"
            >
              <IconPlus size={14} className="text-ink-3" />
              新建空间
            </button>
          )}

          <div className="my-[4px] border-t border-line" />

          <button
            type="button"
            onClick={() => {
              setPendingWorkspace(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] text-ink-3 transition hover:bg-hover"
          >
            <IconX size={12} />
            无工作空间
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Welcome View ────────────────────────────── */

function WelcomeView() {
  const { activeCategory, setActiveCategory } = useUIStore();
  const [text, setText] = useState("");
  const currentTaskId = useSessionStore((s) => s.currentTaskId);
  const createTask = useSessionStore((s) => s.createTask);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setModelSettingsOpen = useUIStore((s) => s.setModelSettingsOpen);
  const defaultProviderId = useDefaultProviderId();
  const [welcomeProviderId, setWelcomeProviderId] = useState<string | null>(defaultProviderId);

  // 当默认模型变化（如删除模型）时同步欢迎页选择
  const effectiveProviderId = welcomeProviderId ?? defaultProviderId;

  const currentTags = activeCategory === "daily" ? dailyTags : codingTags;

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    try {
      let taskId = currentTaskId;
      if (!taskId) {
        const pendingWorkspaceId = useSessionStore.getState().pendingWorkspaceId;
        const task = await createTask(
          pendingWorkspaceId
            ? {
                type: "workspace",
                workspaceId: pendingWorkspaceId,
                title: trimmed.slice(0, 30),
                providerId: effectiveProviderId ?? undefined,
              }
            : {
                type: "temp",
                title: trimmed.slice(0, 30),
                providerId: effectiveProviderId ?? undefined,
              },
        );
        taskId = task.id;
      }
      setText("");
      await sendMessage(taskId, trimmed);
    } catch (err) {
      console.error("[WelcomeView] 发送失败:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex min-h-full flex-col items-center">
      {/* ── Centered Content ── */}
      <div className="flex w-full max-w-[600px] flex-col items-center pt-[130px]">
        {/* Title */}
        <h1 className="font-display text-[34px] font-medium tracking-tight text-ink">
          EveryBuddy, 我帮你
        </h1>

        {/* Mode Tabs */}
        <div className="mt-[24px] flex gap-[8px]">
          {modes.map((mode) => {
            const isActive = activeCategory === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setActiveCategory(mode.id)}
                className={`h-[36px] rounded-full px-[20px] text-[14px] font-medium transition active:scale-[0.97] ${
                  isActive ? "bg-ink text-card" : "bg-hover text-ink-2 hover:bg-active"
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* ── Input Area ── */}
        <div className="mt-[24px] w-[700px]">
          {/* Quick Tags - above input, left-aligned, same width */}
          {currentTags.length > 0 && (
            <div className="mb-[10px] flex justify-start gap-[12px]">
              {currentTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="flex h-[32px] items-center gap-[6px] rounded-full border border-line bg-card px-[14px] text-[13px] text-ink-2 transition hover:border-line-strong hover:bg-hover"
                >
                  <IconClock size={12} className="text-ink-3" />
                  {tag.label}
                </button>
              ))}
            </div>
          )}

          <div className="relative h-[160px] rounded-l border border-line bg-card shadow-card transition focus-within:border-accent">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="今天帮你做些什么？"
              rows={3}
              className="h-full w-full resize-none border-0 bg-transparent px-[20px] pt-[20px] text-[16px] text-ink placeholder:text-ink-3 focus:outline-none"
            />

            {/* Bottom toolbar */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-[14px] pb-[10px]">
              <div className="flex items-center gap-[16px]">
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-3 transition hover:bg-hover hover:text-ink-2"
                >
                  <IconPlus />
                </button>
                <span className="text-[13px] text-ink-3">@引用对话文件，/调用技能与指令</span>
              </div>

              <div className="flex items-center gap-[8px]">
                {/* Model selector */}
                <ModelSelector
                  selectedId={effectiveProviderId}
                  onSelect={(id) => {
                    setWelcomeProviderId(id);
                    // 同步 uiStore 的默认值，使新建任务默认使用该模型
                    useUIStore.getState().setCurrentModel(id);
                  }}
                  onOpenSettings={() => setModelSettingsOpen(true)}
                />

                {/* Mic */}
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-3 transition hover:bg-hover hover:text-ink-2"
                >
                  <IconMic />
                </button>

                {/* Send */}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!text.trim()}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-strong active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <IconArrowUp strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-[14px] flex w-[700px] items-center justify-between">
          <WorkspaceSelector />
          <button
            type="button"
            className="flex items-center gap-[4px] text-[12px] text-ink-3 transition hover:text-ink-2"
          >
            默认权限
            <IconChevronDown size={10} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Chat View ───────────────────────────────── */

function ChatView({ taskId }: { taskId: string }) {
  const { task, messages } = useSessionStore(
    useShallow((s) => {
      const t = s.tasks.find((item) => item.id === taskId);
      return { task: t, messages: t?.messages ?? [] };
    }),
  );

  const [text, setText] = useState("");
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const abortTask = useSessionStore((s) => s.abortTask);
  const setTaskProvider = useSessionStore((s) => s.setTaskProvider);
  const setModelSettingsOpen = useUIStore((s) => s.setModelSettingsOpen);
  const defaultProviderId = useDefaultProviderId();

  const taskProviderId = task?.providerId ?? defaultProviderId;
  const isStreaming = task?.isStreaming ?? false;
  const hydrating = useSessionStore((s) => s.hydratingIds.includes(taskId));

  // 自动滚动到底部：仅当用户已在底部附近时，避免打断查看历史
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 需在消息变化时触发自动滚动（effect 仅引用 ref，deps 用于触发时机）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText("");
    try {
      await sendMessage(taskId, trimmed);
    } catch (err) {
      console.error("[ChatView] 发送失败:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center">
            <p className="text-sm text-ink-3">
              {hydrating ? "加载历史中…" : "新会话，发送消息开始对话"}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {groups.map((g) => {
              const first = g.messages[0];
              if (!first) return null;
              return g.kind === "assistant" ? (
                <AssistantGroup key={first.id} messages={g.messages} />
              ) : (
                <MessageBubble key={first.id} message={first} />
              );
            })}
          </div>
        )}
      </div>

      {/* Chat input */}
      <div className="border-t border-line bg-paper px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative h-[120px] rounded-l border border-line bg-card shadow-card transition focus-within:border-accent">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="今天帮你做些什么？ @引用对话文件，/调用技能与指令"
              rows={2}
              className="h-full w-full resize-none border-0 bg-transparent px-[20px] pt-[16px] text-[16px] text-ink placeholder:text-ink-3 focus:outline-none"
            />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-[14px] pb-[10px]">
              <button
                type="button"
                className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-3 transition hover:bg-hover hover:text-ink-2"
              >
                <IconPlus />
              </button>
              <div className="flex items-center gap-[8px]">
                <ModelSelector
                  selectedId={taskProviderId}
                  onSelect={(id) => setTaskProvider(taskId, id)}
                  onOpenSettings={() => setModelSettingsOpen(true)}
                />
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-3 transition hover:bg-hover hover:text-ink-2"
                >
                  <IconMic />
                </button>
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => void abortTask(taskId)}
                    title="停止生成"
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-strong active:scale-95"
                  >
                    <IconStop size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!text.trim()}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-strong active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <IconArrowUp strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
