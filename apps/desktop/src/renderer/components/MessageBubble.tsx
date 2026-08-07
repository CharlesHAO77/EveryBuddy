/**
 * MessageBubble - 用户消息与错误消息渲染（见 §0.4 / §6.3）。
 * 助手消息（一个 turn 内可能含多轮思考/文本/工具）由 AssistantGroup 合并渲染。
 */
import type { ChatMessage } from "../stores/sessionStore";
import { IconAlertTriangle } from "./icons";
import { TextCard } from "./TextCard";
import { ThinkingCard } from "./ThinkingCard";
import { ToolCallCard } from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

/** 用户消息 / 错误消息 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const time = formatTime(message.timestamp);
  if (message.errorMessage) {
    return (
      <div className="flex justify-start">
        <div className="flex items-start gap-1.5 rounded-m border border-danger/30 bg-danger/5 px-4 py-2 text-[14px] text-danger">
          <IconAlertTriangle size={14} className="mt-[3px] shrink-0" />
          <span>{message.errorMessage}</span>
        </div>
      </div>
    );
  }
  // 用户消息：右侧单文本气泡
  const text = message.blocks.find((b) => b.kind === "text")?.content ?? "";
  return (
    <div className="flex w-full justify-end">
      <div className="max-w-[80%] rounded-l rounded-br-none bg-accent px-4 py-3 text-sm text-white shadow-card">
        <div className="whitespace-pre-wrap">{text}</div>
        <div className="mt-1 text-right text-[11px] text-accent-tint">{time}</div>
      </div>
    </div>
  );
}

interface AssistantGroupProps {
  messages: ChatMessage[];
}

/**
 * AssistantGroup - 助手消息组渲染。
 * 一个 agent 消息含多个 turn（每个 turn = 一次 LLM 调用 + 工具执行，对应一条 assistant 消息），
 * 合并为一条 AI 消息；时间戳仅在整条消息结束（最后一个 turn_end 后，非流式）时显示一次。
 */
export function AssistantGroup({ messages }: AssistantGroupProps) {
  const isStreaming = messages.some((m) => m.isStreaming);
  const lastMsg = messages[messages.length - 1];
  const time = lastMsg ? formatTime(lastMsg.timestamp) : "";
  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-[85%] flex-col gap-1.5">
        {messages.flatMap((m) =>
          m.blocks.map((block) => {
            const key = `${m.id}-${block.id}`;
            if (block.kind === "text")
              return <TextCard key={key} block={block} streaming={m.isStreaming ?? false} />;
            if (block.kind === "thinking")
              return <ThinkingCard key={key} block={block} streaming={m.isStreaming ?? false} />;
            return <ToolCallCard key={key} block={block} />;
          }),
        )}
        {!isStreaming && <div className="mt-0.5 text-[11px] text-ink-3">{time}</div>}
      </div>
    </div>
  );
}
