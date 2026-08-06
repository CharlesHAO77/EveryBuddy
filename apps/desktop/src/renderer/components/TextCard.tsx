/**
 * TextCard - 文本消息卡片（重点，见 §0.4 / §6.4）。
 * 全宽左对齐，Markdown 渲染，流式时光标闪烁。
 */
import type { TextBlock } from "../stores/sessionStore";
import { MarkdownText } from "./MarkdownText";

interface TextCardProps {
  block: TextBlock;
  /** 消息是否仍在流式：block.done 丢失时仍可及时收起光标（纵深防御） */
  streaming: boolean;
}

export function TextCard({ block, streaming }: TextCardProps) {
  return (
    <div className="rounded-m border border-line bg-card px-4 py-3">
      <MarkdownText content={block.content} />
      {!block.done && streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-ink-3 align-middle" />
      )}
    </div>
  );
}
