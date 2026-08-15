/**
 * CompactionNoticeCard - 压缩边界提示卡（历史回放用）。
 * 会话发生过 SDK 上下文压缩时，在保留的第一条消息之前插入，说明更早内容已被系统压缩汇总。
 * 与其他消息卡片一样左对齐；默认折叠，点击标题展开压缩摘要（markdown，经 MarkdownText 渲染）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconChevronDown, IconChevronRight, IconSparkles } from "./icons";
import { MarkdownText } from "./MarkdownText";

interface CompactionNoticeCardProps {
  /** 压缩摘要（markdown） */
  summary: string;
}

export function CompactionNoticeCard({ summary }: CompactionNoticeCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-full flex-col rounded-m border border-accent-line bg-accent-tint px-3.5 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 py-1 text-left transition hover:opacity-80"
        >
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-white">
            <IconSparkles size={10} strokeWidth={2.2} />
          </span>
          <span className="text-[12px] font-bold text-accent-strong">{t("chat.compacted")}</span>
          <span className="ml-auto flex items-center text-accent-strong">
            {expanded ? (
              <IconChevronDown size={11} strokeWidth={2.2} />
            ) : (
              <IconChevronRight size={11} strokeWidth={2.2} />
            )}
          </span>
        </button>
        {expanded && (
          <div className="mt-1 max-h-96 overflow-y-auto border-t border-accent-line px-1 pt-2 text-[13px] text-ink-2">
            <MarkdownText content={summary} />
          </div>
        )}
      </div>
    </div>
  );
}
