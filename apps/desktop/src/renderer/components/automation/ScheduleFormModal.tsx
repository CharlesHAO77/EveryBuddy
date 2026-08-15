import type { AgentMode, ScheduledTask, ScheduleSpec } from "@everybuddy/ipc-contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../i18n/translateError";
import { humanizeSchedule, presetCron, validateCronShape } from "../../scheduleUtils";
import { useAutomationStore } from "../../stores/automationStore";
import { IconX } from "../icons";

type TabId = "preset" | "cron" | "once";
type PresetId = "hourly" | "daily" | "weekly" | "monthly";

interface ScheduleFormModalProps {
  /** null = 新建；否则为编辑 */
  task: ScheduledTask | null;
  onClose: () => void;
}

const DOW_OPTIONS = [
  { v: "1", labelKey: "time.dow.1" },
  { v: "2", labelKey: "time.dow.2" },
  { v: "3", labelKey: "time.dow.3" },
  { v: "4", labelKey: "time.dow.4" },
  { v: "5", labelKey: "time.dow.5" },
  { v: "6", labelKey: "time.dow.6" },
  { v: "0", labelKey: "time.dow.0" },
];

export function ScheduleFormModal({ task, onClose }: ScheduleFormModalProps) {
  const { t } = useTranslation();
  const createTask = useAutomationStore((s) => s.createTask);
  const updateTask = useAutomationStore((s) => s.updateTask);

  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [tab, setTab] = useState<TabId>(task?.spec.type === "once" ? "once" : "cron");
  const [preset, setPreset] = useState<PresetId>("daily");
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [dow, setDow] = useState("1");
  const [dom, setDom] = useState("1");
  const [cron, setCron] = useState(task?.spec.type === "cron" ? task.spec.cron : "0 9 * * *");
  const [delayMin, setDelayMin] = useState(30);
  const [mode, setMode] = useState<AgentMode>(task?.mode ?? "daily");
  const [notify, setNotify] = useState(task?.notify ?? true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [saving, onClose]);

  const buildSpec = (): ScheduleSpec => {
    if (tab === "cron") return { type: "cron", cron: cron.trim() };
    if (tab === "once") {
      const runAt = new Date(Date.now() + delayMin * 60000).toISOString();
      return { type: "once", runAt };
    }
    return {
      type: "cron",
      cron: presetCron(preset, { h: hour, m: minute }, Number(dow), Number(dom)),
    };
  };

  const previewSpec: ScheduleSpec = (() => {
    if (tab === "preset") return buildSpec();
    if (tab === "cron") return { type: "cron", cron: cron.trim() };
    return { type: "once", runAt: new Date(Date.now() + delayMin * 60000).toISOString() };
  })();

  const cronError = tab === "cron" ? validateCronShape(cron, t) : null;

  const handleSubmit = async () => {
    setError(null);
    if (!title.trim()) return setError(t("errors.titleRequired"));
    if (!prompt.trim()) return setError(t("errors.promptRequired"));
    if (tab === "cron" && cronError) return setError(cronError);
    setSaving(true);
    try {
      const spec = buildSpec();
      if (task) {
        await updateTask(task.id, {
          title: title.trim(),
          prompt: prompt.trim(),
          spec,
          mode,
          notify,
        });
      } else {
        await createTask({ title: title.trim(), prompt: prompt.trim(), spec, mode, notify });
      }
      onClose();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      setError(translateError(raw, t));
    } finally {
      setSaving(false);
    }
  };

  const pad = (n: number) => String(n).padStart(2, "0");
  const timeText = `${pad(hour)}:${pad(minute)}`;
  const presetPreview =
    preset === "hourly"
      ? t("schedule.presetHourlyPreview")
      : preset === "weekly"
        ? t("schedule.presetWeeklyPreview", {
            name: t(DOW_OPTIONS.find((d) => d.v === dow)?.labelKey ?? "time.dow.1"),
            time: timeText,
          })
        : preset === "monthly"
          ? t("schedule.presetMonthlyPreview", { day: dom, time: timeText })
          : t("schedule.presetDailyPreview", { time: timeText });

  const inputCls =
    "w-full rounded-s border border-line-strong bg-card px-3 py-[7px] text-[13.5px] text-ink transition placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-tint";
  const selCls =
    "h-[34px] rounded-s border border-line-strong bg-card px-2 text-[13px] text-ink focus:border-accent focus:outline-none";

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 遮罩点击关闭是 Modal 通用模式，键盘侧由 Escape 处理
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="max-h-[calc(100vh-48px)] w-[560px] max-w-[calc(100vw-40px)] overflow-y-auto rounded-xl border border-line-strong bg-paper p-5 shadow-modal">
        <div className="mb-4 flex items-center">
          <h3 className="text-[16px] font-semibold text-ink">
            {task ? t("automation.editTitle") : t("automation.new")}
          </h3>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="ml-auto flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-3 transition hover:bg-hover hover:text-ink"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="mb-[14px]">
          <label
            htmlFor="sched-title"
            className="mb-[6px] block text-[12px] font-semibold text-ink-2"
          >
            {t("automation.titleLabel")} <span className="text-danger">*</span>
          </label>
          <input
            id="sched-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("automation.titlePlaceholder")}
            className={inputCls}
          />
        </div>

        <div className="mb-[14px]">
          <div className="mb-[6px] flex items-center">
            <label htmlFor="sched-prompt" className="text-[12px] font-semibold text-ink-2">
              {t("automation.promptLabel")} <span className="text-danger">*</span>
            </label>
            <span className="ml-auto text-[11px] text-ink-3">{t("automation.promptHint")}</span>
          </div>
          <textarea
            id="sched-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder={t("automation.promptPlaceholder")}
            className={`${inputCls} resize-y leading-[1.6]`}
          />
        </div>

        <div className="mb-[14px]">
          <div className="mb-[6px] block text-[12px] font-semibold text-ink-2">
            {t("automation.schedule")}
          </div>
          <div className="flex gap-[2px] rounded-s bg-hover p-[3px]">
            {(
              [
                { id: "preset", labelKey: "automation.tab.preset" },
                { id: "cron", labelKey: "automation.tab.cron" },
                { id: "once", labelKey: "automation.tab.once" },
              ] as const
            ).map((tabItem) => (
              <button
                key={tabItem.id}
                type="button"
                onClick={() => setTab(tabItem.id)}
                className={`h-[28px] flex-1 rounded-s text-[12.5px] font-semibold transition ${
                  tab === tabItem.id ? "bg-card text-ink shadow-card" : "text-ink-2 hover:text-ink"
                }`}
              >
                {t(tabItem.labelKey)}
              </button>
            ))}
          </div>

          <div className="mt-[10px]">
            {tab === "preset" && (
              <div className="flex flex-wrap items-center gap-[10px]">
                <select
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as PresetId)}
                  className={selCls}
                >
                  <option value="daily">{t("schedule.preset.daily")}</option>
                  <option value="weekly">{t("schedule.preset.weekly")}</option>
                  <option value="monthly">{t("schedule.preset.monthly")}</option>
                  <option value="hourly">{t("schedule.preset.hourly")}</option>
                </select>
                {preset !== "hourly" && (
                  <>
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={hour}
                      onChange={(e) => setHour(Number(e.target.value))}
                      className={`${selCls} w-[64px]`}
                    />
                    <span className="text-[13px] text-ink-3">:</span>
                    <input
                      type="number"
                      min={0}
                      max={59}
                      value={minute}
                      onChange={(e) => setMinute(Number(e.target.value))}
                      className={`${selCls} w-[64px]`}
                    />
                  </>
                )}
                {preset === "weekly" && (
                  <select value={dow} onChange={(e) => setDow(e.target.value)} className={selCls}>
                    {DOW_OPTIONS.map((d) => (
                      <option key={d.v} value={d.v}>
                        {t(d.labelKey)}
                      </option>
                    ))}
                  </select>
                )}
                {preset === "monthly" && (
                  <select value={dom} onChange={(e) => setDom(e.target.value)} className={selCls}>
                    {[1, 2, 3, 5, 10, 15, 20, 25].map((d) => (
                      <option key={d} value={d}>
                        {t("schedule.daySuffix", { day: d })}
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-[5px] w-full text-[11.5px] text-ink-3">{presetPreview}</p>
              </div>
            )}

            {tab === "cron" && (
              <>
                <input
                  value={cron}
                  onChange={(e) => setCron(e.target.value)}
                  placeholder={t("schedule.cronPlaceholder")}
                  className={inputCls}
                />
                {cronError ? (
                  <p className="mt-[5px] text-[11.5px] text-danger">{cronError}</p>
                ) : (
                  <p className="mt-[5px] text-[11.5px] text-ink-3">
                    {t("schedule.cronHelpPrefix")}{" "}
                    <code className="rounded-s bg-hover px-[4px] text-[11px]">0 9 * * 1-5</code>
                    {t("schedule.cronHelpWorkdays")}
                    <code className="rounded-s bg-hover px-[4px] text-[11px]">*/30 * * * *</code>
                    {t("schedule.cronHelpEvery30")}
                  </p>
                )}
              </>
            )}

            {tab === "once" && (
              <>
                <div className="flex items-center gap-[10px]">
                  <input
                    type="number"
                    min={1}
                    value={delayMin}
                    onChange={(e) => setDelayMin(Number(e.target.value))}
                    className={`${selCls} w-[88px]`}
                  />
                  <span className="text-[13px] text-ink-2">{t("schedule.minutesLaterOnce")}</span>
                </div>
                <p className="mt-[5px] text-[11.5px] text-ink-3">{t("schedule.onceHint")}</p>
              </>
            )}
            <p className="mt-[6px] text-[11.5px] text-ink-3">
              → {humanizeSchedule(previewSpec, t)}
            </p>
          </div>
        </div>

        <div className="mb-[14px]">
          <div className="mb-[6px] block text-[12px] font-semibold text-ink-2">
            {t("automation.modeLabel")}
          </div>
          <div className="flex gap-[2px] rounded-s bg-hover p-[3px]">
            {(
              [
                { id: "daily", labelKey: "automation.modeTab.daily" },
                { id: "coding", labelKey: "automation.modeTab.coding" },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={`h-[28px] flex-1 rounded-s text-[12.5px] font-semibold transition ${
                  mode === m.id ? "bg-card text-ink shadow-card" : "text-ink-2 hover:text-ink"
                }`}
              >
                {t(m.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-[8px] text-[13px] text-ink-2">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => setNotify(e.target.checked)}
            className="h-[15px] w-[15px] accent-[var(--accent)]"
          />
          {t("automation.notifyMe")}
        </label>

        {error && <p className="mt-3 text-[13px] text-danger">{error}</p>}

        <div className="mt-5 flex justify-end gap-[10px] border-t border-line pt-[14px]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-s border border-line-strong px-4 py-[7px] text-[13.5px] font-semibold text-ink-2 transition hover:bg-hover"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSubmit()}
            className="rounded-s bg-accent px-4 py-[7px] text-[13.5px] font-semibold text-white transition hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? t("common.saving") : task ? t("common.save") : t("common.create")}
          </button>
        </div>
      </div>
    </div>
  );
}
