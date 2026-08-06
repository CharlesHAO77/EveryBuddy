import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type ChatMessage, useSessionStore } from "../stores/sessionStore";
import { type CategoryId, useUIStore } from "../stores/uiStore";
import { AssistantGroup, MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";

/* ── Inline SVG Icons ─────────────────────────── */

const PlusIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const MicIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10v1a7 7 0 0014 0v-1" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const SendIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#fff"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const StopIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#fff">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const ChevronDownSmall = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="2"
    strokeLinecap="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const FolderSmallIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#333"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

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
    <main className="relative flex flex-1 flex-col overflow-hidden bg-white">
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
        className="flex items-center gap-[4px] text-[12px] text-[#999] transition hover:text-[#666]"
      >
        {label}
        <ChevronDownSmall />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-[6px] w-[220px] rounded-[10px] border border-[#e8e8e8] bg-white py-[6px] shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => {
                setPendingWorkspace(ws.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] transition hover:bg-[#f5f5f5] ${
                ws.id === pendingWorkspaceId ? "text-[#111]" : "text-[#333]"
              }`}
            >
              <FolderSmallIcon />
              <span className="flex-1 truncate">{ws.name}</span>
              {ws.id === pendingWorkspaceId && <CheckIcon />}
            </button>
          ))}

          <div className="my-[4px] border-t border-[#eee]" />

          <button
            type="button"
            onClick={handlePickFolder}
            className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] text-[#333] transition hover:bg-[#f5f5f5]"
          >
            <FolderSmallIcon />
            指定文件夹
          </button>

          {creating ? (
            <div className="px-[10px] py-[6px]">
              <input
                type="text"
                value={name}
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
                className="w-full rounded-md border border-[#e8e8e8] px-[8px] py-[5px] text-[13px] text-[#333] focus:border-[#ccc] focus:outline-none"
              />
              <div className="mt-[6px] flex gap-[6px]">
                <button
                  type="button"
                  onClick={() => void handleCreateNamed()}
                  disabled={!name.trim()}
                  className="rounded-md bg-[#555] px-[10px] py-[4px] text-[12px] text-white transition hover:bg-[#333] disabled:opacity-30"
                >
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setName("");
                  }}
                  className="rounded-md px-[10px] py-[4px] text-[12px] text-[#999] transition hover:bg-[#f0f0f0]"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] text-[#333] transition hover:bg-[#f5f5f5]"
            >
              <PlusIcon />
              新建空间
            </button>
          )}

          <div className="my-[4px] border-t border-[#eee]" />

          <button
            type="button"
            onClick={() => {
              setPendingWorkspace(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[13px] text-[#999] transition hover:bg-[#f5f5f5]"
          >
            ✕ 无工作空间
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
        <h1 className="text-[32px] font-semibold tracking-tight text-[#111]">EveryBuddy, 我帮你</h1>

        {/* Mode Tabs */}
        <div className="mt-[24px] flex gap-[8px]">
          {modes.map((mode) => {
            const isActive = activeCategory === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setActiveCategory(mode.id)}
                className={`h-[36px] rounded-[20px] px-[20px] text-[14px] font-medium transition active:scale-[0.97] ${
                  isActive ? "bg-[#111] text-white" : "bg-[#f5f5f5] text-[#666] hover:bg-[#ebebeb]"
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
                  className="flex h-[32px] items-center gap-[6px] rounded-[16px] border border-[#e8e8e8] bg-white px-[14px] text-[13px] text-[#666] transition hover:bg-[#f5f5f5]"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#999"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  {tag.label}
                </button>
              ))}
            </div>
          )}

          <div className="relative h-[160px] rounded-[18px] border border-[#eee] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.04)] transition focus-within:border-[#ddd]">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="今天帮你做些什么？"
              rows={3}
              className="h-full w-full resize-none border-0 bg-transparent px-[20px] pt-[20px] text-[16px] text-[#333] placeholder:text-[#999] focus:outline-none"
            />

            {/* Bottom toolbar */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-[14px] pb-[10px]">
              <div className="flex items-center gap-[16px]">
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-[#999] transition hover:bg-[#f0f0f0]"
                >
                  <PlusIcon />
                </button>
                <span className="text-[13px] text-[#999]">@引用对话文件，/调用技能与指令</span>
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
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-[#999] transition hover:bg-[#f0f0f0]"
                >
                  <MicIcon />
                </button>

                {/* Send */}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!text.trim()}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#555] text-white transition hover:bg-[#333] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <SendIcon />
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
            className="flex items-center gap-[4px] text-[12px] text-[#999] transition hover:text-[#666]"
          >
            默认权限
            <ChevronDownSmall />
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
            <p className="text-sm text-[#999]">
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
      <div className="border-t border-[#eee] bg-white px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative h-[120px] rounded-[18px] border border-[#eee] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.04)] transition focus-within:border-[#ddd]">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="今天帮你做些什么？ @引用对话文件，/调用技能与指令"
              rows={2}
              className="h-full w-full resize-none border-0 bg-transparent px-[20px] pt-[16px] text-[16px] text-[#333] placeholder:text-[#999] focus:outline-none"
            />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-[14px] pb-[10px]">
              <button
                type="button"
                className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-[#999] transition hover:bg-[#f0f0f0]"
              >
                <PlusIcon />
              </button>
              <div className="flex items-center gap-[8px]">
                <ModelSelector
                  selectedId={taskProviderId}
                  onSelect={(id) => setTaskProvider(taskId, id)}
                  onOpenSettings={() => setModelSettingsOpen(true)}
                />
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-md text-[#999] transition hover:bg-[#f0f0f0]"
                >
                  <MicIcon />
                </button>
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => void abortTask(taskId)}
                    title="停止生成"
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#555] text-white transition hover:bg-[#333] active:scale-95"
                  >
                    <StopIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!text.trim()}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-[#555] text-white transition hover:bg-[#333] active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <SendIcon />
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
