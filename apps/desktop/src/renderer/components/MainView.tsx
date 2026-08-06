import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { type ChatMessage, useSessionStore } from "../stores/sessionStore";
import { type CategoryId, useUIStore } from "../stores/uiStore";
import { AssistantGroup, MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";

/* ── Inline SVG Icons ─────────────────────────── */

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const MicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="11" rx="3" />
    <path d="M5 10v1a7 7 0 0014 0v-1" />
    <line x1="12" y1="19" x2="12" y2="23" />
    <line x1="8" y1="23" x2="16" y2="23" />
  </svg>
);

const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const ChevronDownSmall = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="2" strokeLinecap="round">
    <polyline points="6 9 12 15 18 9" />
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

const dailyTags = [
  { id: "ppt", label: "PPT生成" },
];

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
      {currentTaskId ? (
        <ChatView taskId={currentTaskId} />
      ) : (
        <WelcomeView />
      )}
    </main>
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
        const task = await createTask({
          type: "temp",
          title: trimmed.slice(0, 30),
          providerId: effectiveProviderId ?? undefined,
        });
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
        <h1 className="text-[32px] font-semibold tracking-tight text-[#111]">
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
                className={`h-[36px] rounded-[20px] px-[20px] text-[14px] font-medium transition active:scale-[0.97] ${
                  isActive
                    ? "bg-[#111] text-white"
                    : "bg-[#f5f5f5] text-[#666] hover:bg-[#ebebeb]"
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
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#999" strokeWidth="1.5" strokeLinecap="round">
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
          <button
            type="button"
            className="flex items-center gap-[4px] text-[12px] text-[#999] transition hover:text-[#666]"
          >
            选择工作空间
            <ChevronDownSmall />
          </button>
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
  const setTaskProvider = useSessionStore((s) => s.setTaskProvider);
  const setModelSettingsOpen = useUIStore((s) => s.setModelSettingsOpen);
  const defaultProviderId = useDefaultProviderId();

  const taskProviderId = task?.providerId ?? defaultProviderId;

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
            <p className="text-sm text-[#999]">新会话，发送消息开始对话</p>
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
      </div>
    </div>
  );
}
