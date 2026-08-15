import type { ScheduledTask } from "@everybuddy/ipc-contract";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { humanizeSchedule } from "../../scheduleUtils";
import { ActionMenu, type MenuItem } from "../ActionMenu";
import { IconClock, IconZap } from "../icons";

interface AutomationTaskCardProps {
  task: ScheduledTask;
  active: boolean;
  onSelect: () => void;
  onRunNow: () => void;
  onEdit: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

function relativeTime(iso: string | undefined, t: TFunction): string {
  if (!iso) return t("automation.neverRun");
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return t("time.justNow");
  if (min < 60) return t("time.minutes", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return t("time.hours", { count: hr });
  const day = Math.floor(hr / 24);
  if (day < 30) return t("time.days", { count: day });
  const d = new Date(iso);
  return t("time.monthDay", { month: d.getMonth() + 1, day: d.getDate() });
}

/** lastStatus → 徽标配色（label 为 i18n key） */
function statusChip(status?: ScheduledTask["lastStatus"]) {
  switch (status) {
    case "success":
      return {
        cls: "bg-accent-tint text-accent-strong border-accent-line",
        dot: "bg-accent",
        labelKey: "automation.status.success",
      };
    case "failed":
      return {
        cls: "bg-danger/10 text-danger-strong border-danger/30",
        dot: "bg-danger",
        labelKey: "automation.status.failed",
      };
    case "running":
      return {
        cls: "bg-accent-tint text-accent-strong border-accent-line",
        dot: "bg-accent animate-pulse",
        labelKey: "automation.status.running",
      };
    case "cancelled":
      return {
        cls: "bg-danger/10 text-danger-strong border-danger/30",
        dot: "bg-danger",
        labelKey: "automation.status.cancelled",
      };
    case "skipped":
      return {
        cls: "bg-hover text-ink-3 border-line",
        dot: "bg-ink-3",
        labelKey: "automation.status.skipped",
      };
    default:
      return {
        cls: "bg-hover text-ink-3 border-line",
        dot: "bg-ink-3",
        labelKey: "automation.status.pending",
      };
  }
}

export function AutomationTaskCard({
  task,
  active,
  onSelect,
  onRunNow,
  onEdit,
  onToggleEnabled,
  onDelete,
}: AutomationTaskCardProps) {
  const { t } = useTranslation();
  const chip = statusChip(task.lastStatus);
  const enabledChip = task.enabled
    ? "bg-accent-tint text-accent-strong border-accent-line"
    : "bg-hover text-ink-3 border-line";

  const menuItems: MenuItem[] = [
    { label: "automation.runNow", onSelect: onRunNow },
    { label: "common.edit", onSelect: onEdit },
    {
      label: task.enabled ? "automation.pause" : "automation.resume",
      onSelect: onToggleEnabled,
    },
    { label: "common.delete", danger: true, onSelect: onDelete },
  ];

  return (
    // biome-ignore lint/a11y/useSemanticElements: 行内含 ⋯ 菜单等嵌套交互元素，无法用 button
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect();
      }}
      className={`group cursor-pointer rounded-m border bg-card p-[11px] shadow-card transition ${
        active
          ? "border-accent-line shadow-[0_0_0_1px_var(--accent-line)]"
          : "border-line hover:border-line-strong hover:bg-[#fffdf9]"
      }`}
    >
      <div className="flex items-center gap-[6px]">
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
          {task.title || t("automation.unnamedTask")}
        </span>
        <span
          className={`flex shrink-0 items-center gap-[4px] rounded-full border px-[7px] text-[11px] font-semibold ${enabledChip}`}
        >
          <span className="h-[6px] w-[6px] rounded-full bg-current" />
          {task.enabled ? t("automation.enabled") : t("automation.paused")}
        </span>
        <span
          className={`flex shrink-0 items-center gap-[4px] rounded-full border px-[7px] text-[11px] font-semibold ${chip.cls}`}
        >
          <span className={`h-[6px] w-[6px] rounded-full ${chip.dot}`} />
          {t(chip.labelKey)}
        </span>
        <ActionMenu items={menuItems} />
      </div>

      <div className="mt-[5px] line-clamp-2 text-[12.5px] leading-[1.5] text-ink-2">
        {task.prompt}
      </div>

      <div className="mt-[7px] flex items-center gap-[5px] text-[12px] text-ink-3">
        <IconClock size={13} />
        {humanizeSchedule(task.spec, t)}
      </div>

      <div className="mt-[7px] flex items-center gap-[6px] border-t border-dashed border-line pt-[7px] text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-[4px]">
          <IconZap size={12} />
          {t("automation.lastRunLabel")} {relativeTime(task.lastRunAt, t)}
        </span>
        <span className="inline-flex items-center gap-[4px]">
          <IconZap size={12} />
          {t("automation.nextRunLabel")} {relativeTime(task.nextRunAt, t)}
        </span>
      </div>
    </div>
  );
}
