import type { ScheduledRun } from "@everybuddy/ipc-contract";
import type { TFunction } from "i18next";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../i18n/translateError";
import { formatCost, formatDuration } from "../../scheduleUtils";
import { useAutomationStore } from "../../stores/automationStore";
import { IconChevronDown } from "../icons";

interface RunHistoryListProps {
  taskId: string;
}

function fmtTime(iso: string | undefined, t: TFunction): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t("time.todayAt", { time: hhmm });
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return t("time.yesterdayAt", { time: hhmm });
  return t("time.monthDayAt", {
    month: d.getMonth() + 1,
    day: d.getDate(),
    time: hhmm,
  });
}

/** status → 徽标配色（text 为 i18n key） */
function statusStyle(status: ScheduledRun["status"]) {
  switch (status) {
    case "success":
      return {
        dot: "bg-accent",
        label: "text-accent-strong",
        labelKey: "automation.status.success",
      };
    case "failed":
      return { dot: "bg-danger", label: "text-danger", labelKey: "automation.status.failed" };
    case "running":
      return {
        dot: "bg-accent animate-pulse",
        label: "text-accent-strong",
        labelKey: "automation.status.running",
      };
    case "cancelled":
      return {
        dot: "bg-danger",
        label: "text-danger-strong",
        labelKey: "automation.status.cancelled",
      };
    default:
      return { dot: "bg-ink-3", label: "text-ink-3", labelKey: "automation.status.skipped" };
  }
}

export function RunHistoryList({ taskId }: RunHistoryListProps) {
  const { t } = useTranslation();
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
        {t("automation.noRuns")}
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
              <span className={`shrink-0 text-[11.5px] font-semibold ${st.label}`}>
                {t(st.labelKey)}
              </span>
              <span className="text-[12.5px] tabular-nums text-ink-2">
                {fmtTime(run.startedAt, t)}
              </span>
              {run.status === "running" ? (
                <span className="text-[11.5px] text-ink-3">
                  {run.durationMs != null
                    ? t("automation.hasRunFor", { duration: formatDuration(run.durationMs, t) })
                    : t("automation.runningElapsed")}
                </span>
              ) : (
                <span className="text-[11.5px] text-ink-3">
                  {formatDuration(run.durationMs, t)}
                </span>
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
                    <span>{translateError(run.error, t)}</span>
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
