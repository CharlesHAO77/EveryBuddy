/**
 * ThinkingCard - 思考卡片（弱化，见 §0.4 / §6.5）。
 * 默认折叠，流式时显示「思考中…」，完成后可点击展开。
 */
import { useState } from "react";
import type { ThinkingBlock } from "../stores/sessionStore";
import { IconChevronDown, IconChevronRight, IconLightbulb } from "./icons";

interface ThinkingCardProps {
  block: ThinkingBlock;
  /** 消息是否仍在流式：block.done 丢失时仍可及时收起跳动点（纵深防御） */
  streaming: boolean;
}

export function ThinkingCard({ block, streaming }: ThinkingCardProps) {
  const [expanded, setExpanded] = useState(false);
  // 流式结束后视为完成，兜底 block.done 丢失（SDK 未发 thinking_end）的情况
  const done = block.done || !streaming;

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 rounded-s px-1.5 py-0.5 text-[11px] text-ink-3 transition hover:bg-hover hover:text-ink-2"
      >
        <IconLightbulb size={11} strokeWidth={2} />
        {!done ? (
          <span className="flex items-center gap-1">
            思考中
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-0.5">
            已思考
            {expanded ? (
              <IconChevronDown size={10} strokeWidth={2} />
            ) : (
              <IconChevronRight size={10} strokeWidth={2} />
            )}
          </span>
        )}
      </button>
      {expanded && (
        <div className="mt-1 ml-5 whitespace-pre-wrap rounded-s bg-hover px-3 py-2 text-[12px] text-ink-2">
          {done ? block.content || "（无内容）" : block.content}
        </div>
      )}
    </div>
  );
}
