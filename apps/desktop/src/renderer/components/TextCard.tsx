/**
 * TextCard - 文本消息卡片（重点，见 §0.4 / §6.4）。
 * 全宽左对齐，Markdown 渲染，流式时光标闪烁。
 */
import type { TextBlock } from "../stores/sessionStore";
import { MarkdownText } from "./MarkdownText";

interface TextCardProps {
  block: TextBlock;
}

export function TextCard({ block }: TextCardProps) {
  return (
    <div className="rounded-xl border border-[var(--border-light)] bg-[var(--surface-card)] px-4 py-3">
      <MarkdownText content={block.content} />
      {!block.done && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--text-muted)] align-middle" />
      )}
    </div>
  );
}
