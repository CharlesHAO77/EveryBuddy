import type { ChatMessage } from "../stores/sessionStore";

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const time = new Date(message.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`flex w-full ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
          isUser
            ? "rounded-br-none bg-[var(--primary)] text-white"
            : "rounded-bl-none border border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-main)]"
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
        <div className={`mt-1 text-right text-[10px] ${isUser ? "text-[var(--primary-bg)]" : "text-[var(--text-muted)]"}`}>
          {time}
        </div>
      </div>
    </div>
  );
}
