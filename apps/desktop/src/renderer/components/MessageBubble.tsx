/**
 * MessageBubble - 消息渲染容器（见 §0.4 / §6.3）。
 * 用户消息：右侧单文本气泡。助手消息：左侧按 blocks 顺序渲染卡片列表。
 */
import type { ChatMessage } from "../stores/sessionStore";
import { TextCard } from "./TextCard";
import { ThinkingCard } from "./ThinkingCard";
import { ToolCallCard } from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

export function MessageBubble({ message }: MessageBubbleProps) {
  // 错误消息
  if (message.errorMessage) {
    return (
      <div className="flex justify-start">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-600">
          ⚠ {message.errorMessage}
        </div>
      </div>
    );
  }

  const isUser = message.role === "user";
  const time = formatTime(message.timestamp);

  if (isUser) {
    const text = message.blocks.find((b) => b.kind === "text")?.content ?? "";
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-none bg-[var(--primary)] px-4 py-3 text-sm text-white shadow-sm">
          <div className="whitespace-pre-wrap">{text}</div>
          <div className="mt-1 text-right text-[10px] text-[var(--primary-bg)]">{time}</div>
        </div>
      </div>
    );
  }

  // 助手消息：卡片列表
  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-[85%] flex-col gap-1.5">
        {message.blocks.map((block) => {
          if (block.kind === "text") return <TextCard key={block.id} block={block} />;
          if (block.kind === "thinking") return <ThinkingCard key={block.id} block={block} />;
          return <ToolCallCard key={block.id} block={block} />;
        })}
        {message.blocks.length === 0 && !message.isStreaming && (
          <div className="text-[12px] text-[var(--text-muted)]">（空消息）</div>
        )}
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{time}</div>
      </div>
    </div>
  );
}
