import type { ScheduledTask } from "@everybuddy/ipc-contract";
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

function relativeTime(iso?: string): string {
  if (!iso) return "未运行";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  const d = new Date(iso);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** lastStatus → 徽标配色 */
function statusChip(status?: ScheduledTask["lastStatus"]) {
  switch (status) {
    case "success":
      return {
        cls: "bg-accent-tint text-accent-strong border-accent-line",
        dot: "bg-accent",
        label: "成功",
      };
    case "failed":
      return {
        cls: "bg-danger/10 text-danger-strong border-danger/30",
        dot: "bg-danger",
        label: "失败",
      };
    case "running":
      return {
        cls: "bg-accent-tint text-accent-strong border-accent-line",
        dot: "bg-accent animate-pulse",
        label: "运行中",
      };
    case "cancelled":
      return {
        cls: "bg-danger/10 text-danger-strong border-danger/30",
        dot: "bg-danger",
        label: "已取消",
      };
    case "skipped":
      return { cls: "bg-hover text-ink-3 border-line", dot: "bg-ink-3", label: "已跳过" };
    default:
      return { cls: "bg-hover text-ink-3 border-line", dot: "bg-ink-3", label: "待运行" };
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
  const chip = statusChip(task.lastStatus);
  const enabledChip = task.enabled
    ? "bg-accent-tint text-accent-strong border-accent-line"
    : "bg-hover text-ink-3 border-line";

  const menuItems: MenuItem[] = [
    { label: "立即执行", onSelect: onRunNow },
    { label: "编辑", onSelect: onEdit },
    {
      label: task.enabled ? "暂停" : "恢复",
      onSelect: onToggleEnabled,
    },
    { label: "删除", danger: true, onSelect: onDelete },
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
          {task.title || "未命名任务"}
        </span>
        <span
          className={`flex shrink-0 items-center gap-[4px] rounded-full border px-[7px] text-[11px] font-semibold ${enabledChip}`}
        >
          <span className="h-[6px] w-[6px] rounded-full bg-current" />
          {task.enabled ? "启用" : "已暂停"}
        </span>
        <span
          className={`flex shrink-0 items-center gap-[4px] rounded-full border px-[7px] text-[11px] font-semibold ${chip.cls}`}
        >
          <span className={`h-[6px] w-[6px] rounded-full ${chip.dot}`} />
          {chip.label}
        </span>
        <ActionMenu items={menuItems} />
      </div>

      <div className="mt-[5px] line-clamp-2 text-[12.5px] leading-[1.5] text-ink-2">
        {task.prompt}
      </div>

      <div className="mt-[7px] flex items-center gap-[5px] text-[12px] text-ink-3">
        <IconClock size={13} />
        {humanizeSchedule(task.spec)}
      </div>

      <div className="mt-[7px] flex items-center gap-[6px] border-t border-dashed border-line pt-[7px] text-[11.5px] text-ink-3">
        <span className="inline-flex items-center gap-[4px]">
          <IconZap size={12} />
          上次 {relativeTime(task.lastRunAt)}
        </span>
        <span className="inline-flex items-center gap-[4px]">
          <IconZap size={12} />
          下次 {relativeTime(task.nextRunAt)}
        </span>
      </div>
    </div>
  );
}
