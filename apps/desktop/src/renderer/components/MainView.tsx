import { useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useUIStore, type CategoryId } from "../stores/uiStore";
import { MessageBubble } from "./MessageBubble";

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
  const currentSessionId = useSessionStore((s) => s.currentSessionId);

  return (
    <main className="relative flex flex-1 flex-col overflow-hidden bg-white">
      {currentSessionId ? (
        <ChatView sessionId={currentSessionId} />
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
  const { currentSessionId, createSession, addMessage } = useSessionStore();

  const currentTags = activeCategory === "daily" ? dailyTags : codingTags;

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const sessionId = currentSessionId ?? createSession("新任务");
    addMessage(sessionId, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    });
    setText("");
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
                <button
                  type="button"
                  className="flex items-center gap-[4px] rounded-[6px] px-[8px] py-[4px] text-[12px] text-[#999] transition hover:bg-[#f0f0f0]"
                >
                  MiniMax-M3
                  <ChevronDownSmall />
                </button>

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

function ChatView({ sessionId }: { sessionId: string }) {
  const messages = useSessionStore((s) => {
    const session = s.sessions.find((item) => item.id === sessionId);
    return session?.messages ?? [];
  });

  const [text, setText] = useState("");
  const { addMessage } = useSessionStore();

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    addMessage(sessionId, {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: Date.now(),
    });
    setText("");
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
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center">
            <p className="text-sm text-[#999]">新会话，发送消息开始对话</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
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
                <button
                  type="button"
                  className="flex items-center gap-[4px] rounded-[6px] px-[8px] py-[4px] text-[12px] text-[#999] transition hover:bg-[#f0f0f0]"
                >
                  MiniMax-M3
                  <ChevronDownSmall />
                </button>
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
