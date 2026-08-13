/**
 * PendingQueueBar - 排队区（见 docs/plans/interaction-optimize.md R2）。
 *
 * 排队消息（followUp）驻留输入框上方队列区，不进对话；当前任务完成后按 FIFO 自动进对话。
 * 只渲染 followUp（steer 消息在对话中，绝不进队列区）。
 * 可折叠/展开：点头部 toggle 明细（默认展开）；每项 = 「排队」chip + 序号 + 预览 + ✕ 单项取消。
 */

import { useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { IconChevronDown, IconX } from "./icons";

export function PendingQueueBar({ taskId }: { taskId: string }) {
  const items = useSessionStore((s) => s.pendingFollowUps[taskId]);
  const cancelFollowUpItem = useSessionStore((s) => s.cancelFollowUpItem);
  const [collapsed, setCollapsed] = useState(false);

  if (!items || items.length === 0) return null;

  return (
    <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-40 rounded-m border border-accent-line bg-card p-1.5 shadow-pop">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        title={collapsed ? "点击展开排队列表" : "点击折叠排队列表"}
        className="flex w-full items-center gap-1.5 rounded-s px-2 pb-1 text-left text-[12px] font-semibold text-accent-strong transition hover:bg-accent-tint"
      >
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
        排队中{" "}
        <span className="rounded bg-hover px-1 text-[10.5px] leading-[1.6] text-ink-2">
          {items.length}
        </span>{" "}
        条 · 当前任务完成后依次处理
        <IconChevronDown
          size={12}
          strokeWidth={2.5}
          className={`ml-auto shrink-0 text-ink-3 transition-transform duration-150 ${
            collapsed ? "-rotate-90" : ""
          }`}
        />
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-0.5">
          {items.map((item, i) => (
            <div
              key={item.id}
              className="flex items-center gap-1.5 rounded-s px-1.5 py-0.5 text-[11.5px] text-ink-2 transition hover:bg-hover"
            >
              <span className="shrink-0 rounded px-1 text-[9.5px] font-bold leading-[1.5] bg-accent-tint text-accent-strong">
                排队
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-3">#{i + 1}</span>
              <span className="truncate">{item.text}</span>
              <button
                type="button"
                aria-label="取消该条排队"
                title="取消该条"
                onClick={(e) => {
                  e.stopPropagation();
                  void cancelFollowUpItem(taskId, item.id);
                }}
                className="ml-auto flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-s text-ink-3 transition hover:bg-active hover:text-ink"
              >
                <IconX size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
