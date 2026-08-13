import type { ScheduledRun } from "@everybuddy/ipc-contract";
import { useEffect, useState } from "react";
import { formatCost, formatDuration } from "../../scheduleUtils";
import { useAutomationStore } from "../../stores/automationStore";
import { IconChevronDown } from "../icons";

interface RunHistoryListProps {
  taskId: string;
}

function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return `今天 ${hhmm}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hhmm}`;
}

function statusStyle(status: ScheduledRun["status"]) {
  switch (status) {
    case "success":
      return { dot: "bg-accent", label: "text-accent-strong", text: "成功" };
    case "failed":
      return { dot: "bg-danger", label: "text-danger", text: "失败" };
    case "running":
      return { dot: "bg-accent animate-pulse", label: "text-accent-strong", text: "运行中" };
    case "cancelled":
      return { dot: "bg-danger", label: "text-danger-strong", text: "已取消" };
    default:
      return { dot: "bg-ink-3", label: "text-ink-3", text: "已跳过" };
  }
}

export function RunHistoryList({ taskId }: RunHistoryListProps) {
  const runs = useAutomationStore((s) => s.runsByTask[taskId]);
  const loadRuns = useAutomationStore((s) => s.loadRuns);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedId(null);
    void loadRuns(taskId);
  }, [taskId, loadRuns]);

  const list = runs ?? [];

  if (list.length === 0) {
    return (
      <div className="rounded-m border border-dashed border-line-strong py-[28px] text-center text-[13px] text-ink-3">
        还没有运行记录，到点自动执行，或点击上方「立即执行」先跑一次。
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      {list.map((run) => {
        const st = statusStyle(run.status);
        const open = expandedId === run.id;
        const hasDetail = Boolean(run.result || run.error);
        return (
          // biome-ignore lint/a11y/useSemanticElements: 行内可点击展开结果，含多条文本不适合用 button
          <div
            key={run.id}
            role="button"
            tabIndex={0}
            onClick={() => hasDetail && setExpandedId(open ? null : run.id)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && hasDetail) {
                setExpandedId(open ? null : run.id);
              }
            }}
            className={`cursor-pointer overflow-hidden rounded-m border bg-card shadow-card transition ${
              open ? "border-accent-line" : "border-line hover:border-line-strong"
            }`}
          >
            <div className="flex items-center gap-[8px] px-[13px] py-[9px]">
              <span className={`h-[8px] w-[8px] shrink-0 rounded-full ${st.dot}`} />
              <span className={`shrink-0 text-[11.5px] font-semibold ${st.label}`}>{st.text}</span>
              <span className="text-[12.5px] tabular-nums text-ink-2">
                {fmtTime(run.startedAt)}
              </span>
              {run.status === "running" ? (
                <span className="text-[11.5px] text-ink-3">
                  {run.durationMs != null ? `已运行 ${formatDuration(run.durationMs)}` : "运行中…"}
                </span>
              ) : (
                <span className="text-[11.5px] text-ink-3">{formatDuration(run.durationMs)}</span>
              )}
              {run.status === "running" ? (
                <span className="ml-auto inline-flex gap-[3px]">
                  <i className="h-[5px] w-[5px] animate-bounce rounded-full bg-accent [animation-delay:0ms]" />
                  <i className="h-[5px] w-[5px] animate-bounce rounded-full bg-accent [animation-delay:150ms]" />
                  <i className="h-[5px] w-[5px] animate-bounce rounded-full bg-accent [animation-delay:300ms]" />
                </span>
              ) : (
                <span className="ml-auto whitespace-nowrap text-[11.5px] font-semibold tabular-nums text-accent-strong">
                  {formatCost(run.usage) ?? ""}
                </span>
              )}
              {hasDetail && (
                <IconChevronDown
                  size={12}
                  className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
                />
              )}
            </div>
            {open && (
              <div className="border-t border-dashed border-line px-[13px] pb-[12px] pt-[10px]">
                {run.result ? (
                  <div className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-s bg-terminal px-[11px] py-[9px] text-[12.5px] leading-[1.65] text-terminal-text">
                    {run.result}
                  </div>
                ) : run.error ? (
                  <div className="flex items-start gap-[6px] rounded-s border border-danger/30 bg-danger/10 px-[11px] py-[8px] text-[12.5px] text-danger">
                    <span className="mt-[1px] text-[14px] leading-none">⚠</span>
                    <span>{run.error}</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
