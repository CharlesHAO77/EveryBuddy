/**
 * ThinkingCard - 思考卡片（弱化，见 §0.4 / §6.5）。
 * 默认折叠，流式时显示「思考中…」，完成后可点击展开。
 */
import { useState } from "react";
import type { ThinkingBlock } from "../stores/sessionStore";

interface ThinkingCardProps {
  block: ThinkingBlock;
}

export function ThinkingCard({ block }: ThinkingCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)]"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z" />
        </svg>
        {!block.done ? (
          <span className="flex items-center gap-1">
            思考中
            <span className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:300ms]" />
            </span>
          </span>
        ) : (
          <span>已思考 {expanded ? "▾" : "▸"}</span>
        )}
      </button>
      {expanded && block.done && (
        <div className="mt-1 ml-5 whitespace-pre-wrap rounded-md bg-[var(--surface-hover)] px-3 py-2 text-[12px] text-gray-500">
          {block.content || "（无内容）"}
        </div>
      )}
      {expanded && !block.done && (
        <div className="mt-1 ml-5 whitespace-pre-wrap rounded-md bg-[var(--surface-hover)] px-3 py-2 text-[12px] text-gray-500">
          {block.content}
        </div>
      )}
    </div>
  );
}
