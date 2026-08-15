/**
 * RunningIndicator - 「运行中」三颗弹跳圆点指示。
 *
 * 复用 ThinkingCard 的 bounce 模式（animate-bounce + 延迟），两处使用：
 *  1. AssistantGroup 流式且尚无内容块时（组内，首 token 前）
 *  2. ChatView 消息列表末尾 task.pending 时（等待首个 assistant 消息的空白期）
 */
import { useTranslation } from "react-i18next";

export function RunningIndicator() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-2 py-1 text-[13px] text-ink-2">
      {t("chat.running")}
      <span className="flex gap-1">
        <span className="h-[7px] w-[7px] animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
        <span className="h-[7px] w-[7px] animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
        <span className="h-[7px] w-[7px] animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
      </span>
    </span>
  );
}
