import type { ScheduledTask } from "@everybuddy/ipc-contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import { humanizeSchedule } from "../../scheduleUtils";
import { useAutomationStore } from "../../stores/automationStore";
import { ConfirmDialog } from "../ConfirmDialog";
import { IconClock, IconPlus, IconZap } from "../icons";
import { AutomationTaskCard } from "./AutomationTaskCard";
import { RunHistoryList } from "./RunHistoryList";
import { ScheduleFormModal } from "./ScheduleFormModal";

/** 详情区操作按钮的通用样式 */
const btnPrimary =
  "inline-flex items-center gap-[6px] rounded-s bg-accent px-[14px] py-[7px] text-[13.5px] font-semibold text-white transition hover:bg-accent-strong active:scale-[0.98]";
const btnGhost =
  "inline-flex items-center gap-[6px] rounded-s border border-line-strong px-[14px] py-[7px] text-[13.5px] font-semibold text-ink-2 transition hover:bg-hover hover:text-ink active:scale-[0.98]";
const btnDanger =
  "inline-flex items-center gap-[6px] rounded-s border border-danger/30 px-[14px] py-[7px] text-[13.5px] font-semibold text-danger transition hover:bg-danger/10 active:scale-[0.98]";

/** 分区小标题（定时任务 / 运行历史）统一样式 */
const sectionLabel =
  "flex items-center gap-[8px] text-[12px] font-semibold tracking-[0.08em] text-ink-2";

export function AutomationView() {
  const { t } = useTranslation();
  const tasks = useAutomationStore((s) => s.tasks);
  const loaded = useAutomationStore((s) => s.loaded);
  const loadTasks = useAutomationStore((s) => s.loadTasks);
  const runNow = useAutomationStore((s) => s.runNow);
  const updateTask = useAutomationStore((s) => s.updateTask);
  const deleteTask = useAutomationStore((s) => s.deleteTask);
  // 顶栏按钮位置按平台区分：mac 右上角即可；win 需让出右上角系统按钮区（WCO ~138px）
  const isWin = document.documentElement.dataset.platform === "win";
  const isMac = document.documentElement.dataset.platform === "mac";

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ScheduledTask | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (!loaded) void loadTasks();
  }, [loaded, loadTasks]);

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  // 选中校正：删除/无选中时落到第一个
  useEffect(() => {
    if (selectedId && !tasks.some((t) => t.id === selectedId)) {
      setSelectedId(tasks[0]?.id ?? null);
    } else if (!selectedId && tasks.length > 0) {
      setSelectedId(tasks[0]?.id ?? null);
    }
  }, [tasks, selectedId]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleteLoading(true);
    try {
      await deleteTask(confirmDelete.id);
      setConfirmDelete(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      {/* ── 页面顶栏（兼作窗口拖动区，对齐 ExpertView 高度/字号）：
       *  图标徽标 + 标题 + 数量 + 新建按钮顶到最上；mac 按钮在右上角，win 按钮在系统图标左侧（pr 让位） ── */}
      <div
        className={`flex h-[60px] shrink-0 items-center gap-[10px] border-b border-line px-[20px] ${
          isWin ? "pr-[160px]" : ""
        } ${isWin || isMac ? "titlebar-drag" : ""}`}
      >
        <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-accent-tint text-accent">
          <IconZap size={18} />
        </div>
        <h1 className="text-[16px] font-semibold text-ink">{t("automation.title")}</h1>
        <span className="flex h-[21px] items-center rounded-full border border-accent-line bg-accent-tint px-[9px] text-[12px] font-semibold leading-none text-accent-strong">
          {tasks.length}
        </span>
        <div className="flex-1" />
        <button type="button" onClick={openCreate} className={`${btnPrimary} titlebar-no-drag`}>
          <IconPlus size={15} />
          {t("automation.new")}
        </button>
      </div>

      {/* ── 主体：任务列表 + 详情 ── */}
      <div className="flex min-h-0 flex-1">
        {/* 左：任务列表（与页面同底色，仅以右边框与详情区分，避免与侧栏同色系） */}
        <div className="flex w-[300px] shrink-0 flex-col border-r border-line bg-paper">
          <div className={`${sectionLabel} px-[16px] pb-[8px] pt-[14px]`}>
            <IconClock size={13} />
            {t("automation.scheduledTasks")}
            <span className="rounded-full border border-accent-line bg-accent-tint px-[7px] text-[11px] font-semibold text-accent-strong">
              {tasks.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[10px] pb-[16px]">
            {tasks.length === 0 ? (
              <div className="mt-[6px] flex flex-col items-center gap-[10px] rounded-m border border-dashed border-line-strong px-[20px] py-[34px] text-center">
                <div className="flex h-[44px] w-[44px] items-center justify-center rounded-m bg-accent-tint text-accent">
                  <IconClock size={22} />
                </div>
                <div className="text-[14px] font-semibold text-ink">
                  {t("automation.emptyTitle")}
                </div>
                <div className="text-[12.5px] leading-[1.6] text-ink-3">
                  {t("automation.emptyDesc1")}
                  <br />
                  {t("automation.emptyDesc2")}
                </div>
                <button type="button" onClick={openCreate} className={`${btnPrimary} mt-[4px]`}>
                  <IconPlus size={15} />
                  {t("automation.new")}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-[8px]">
                {tasks.map((task) => (
                  <AutomationTaskCard
                    key={task.id}
                    task={task}
                    active={task.id === selectedId}
                    onSelect={() => setSelectedId(task.id)}
                    onRunNow={() => void runNow(task.id)}
                    onEdit={() => {
                      setEditing(task);
                      setFormOpen(true);
                    }}
                    onToggleEnabled={() => void updateTask(task.id, { enabled: !task.enabled })}
                    onDelete={() => setConfirmDelete(task)}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右：详情 + 运行历史 */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-paper px-[26px] pb-[30px] pt-[16px]">
          {selected ? (
            <>
              <div className="pt-[10px]">
                <div className="flex flex-wrap items-center gap-[10px] text-[19px] font-bold text-ink">
                  {selected.title || t("automation.unnamedTask")}
                  <span
                    className={`flex shrink-0 items-center gap-[4px] rounded-full border px-[8px] text-[11px] font-semibold ${
                      selected.enabled
                        ? "border-accent-line bg-accent-tint text-accent-strong"
                        : "border-line bg-hover text-ink-3"
                    }`}
                  >
                    <span className="h-[6px] w-[6px] rounded-full bg-current" />
                    {selected.enabled ? t("automation.enabled") : t("automation.paused")}
                  </span>
                </div>
                <div className="mt-[6px] flex items-center gap-[6px] text-[13px] text-ink-2">
                  <IconClock size={14} />
                  {humanizeSchedule(selected.spec, t)} ·{" "}
                  {selected.mode === "coding"
                    ? t("automation.mode.coding")
                    : t("automation.mode.daily")}
                </div>
                <div className="mt-[4px] text-[12px] text-ink-3">
                  {selected.lastRunAt
                    ? t("automation.lastRunAt", {
                        time: new Date(selected.lastRunAt).toLocaleString(i18n.language),
                      })
                    : t("automation.neverRun")}
                  {selected.nextRunAt
                    ? t("automation.nextRunAt", {
                        time: new Date(selected.nextRunAt).toLocaleString(i18n.language),
                      })
                    : ""}
                </div>
              </div>

              <div className="mt-[14px] flex flex-wrap gap-[8px]">
                <button
                  type="button"
                  onClick={() => void runNow(selected.id)}
                  className={btnPrimary}
                >
                  <IconZap size={14} />
                  {t("automation.runNow")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(selected);
                    setFormOpen(true);
                  }}
                  className={btnGhost}
                >
                  {t("common.edit")}
                </button>
                <button
                  type="button"
                  onClick={() => void updateTask(selected.id, { enabled: !selected.enabled })}
                  className={btnGhost}
                >
                  {selected.enabled ? t("automation.pause") : t("automation.resume")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(selected)}
                  className={btnDanger}
                >
                  {t("common.delete")}
                </button>
              </div>

              <div className="mt-[22px]">
                <div className={`${sectionLabel} mb-[8px]`}>
                  {t("automation.runHistory")}
                  <span className="text-[11px] font-normal tracking-normal text-ink-3">
                    {t("automation.expandHint")}
                  </span>
                </div>
                <RunHistoryList taskId={selected.id} />
              </div>
            </>
          ) : (
            <div className="pt-[60px] text-center text-[14px] text-ink-3">
              {t("automation.selectHint")}
            </div>
          )}
        </div>
      </div>

      {formOpen && <ScheduleFormModal task={editing} onClose={() => setFormOpen(false)} />}
      {confirmDelete && (
        <ConfirmDialog
          open
          title={t("automation.deleteTitle")}
          description={t("automation.deleteDesc", { title: confirmDelete.title })}
          confirmLabel="common.delete"
          loading={deleteLoading}
          onConfirm={() => void handleDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
