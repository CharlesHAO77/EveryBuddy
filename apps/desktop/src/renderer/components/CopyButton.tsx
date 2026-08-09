/**
 * CopyButton - 通用复制按钮（复用 MarkdownText.CodeBlock 的剪贴板模式）。
 * 点击后显示「已复制」反馈，1.5s 后复原；剪贴板被拒时静默，避免 unhandled rejection。
 */
import { useState } from "react";
import { IconCheck, IconCopy } from "./icons";

interface CopyButtonProps {
  /** 要复制的文本 */
  text: string;
  /** 未复制时的文案，默认「复制」 */
  label?: string;
  title?: string;
  /** 覆盖默认按钮样式 */
  className?: string;
  /** 图标边长，默认 12 */
  size?: number;
}

export function CopyButton({
  text,
  label = "复制",
  title,
  className,
  size = 12,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={title ?? "复制"}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-s px-1.5 py-0.5 text-[11px] text-ink-3 transition hover:bg-hover hover:text-ink-2 ${
        className ?? ""
      }`}
    >
      {copied ? (
        <IconCheck size={size} strokeWidth={2.5} />
      ) : (
        <IconCopy size={size} strokeWidth={2} />
      )}
      <span>{copied ? "已复制" : label}</span>
    </button>
  );
}
