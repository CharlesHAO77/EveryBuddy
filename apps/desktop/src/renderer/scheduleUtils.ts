/**
 * 自动化（定时任务）渲染层纯函数：调度文案 / cron 校验 / 时长与费用格式化。
 * 文案经 i18n：t 由调用组件传入，保持纯函数可单测。
 */

import type { MessageUsage, ScheduleSpec } from "@everybuddy/ipc-contract";
import type { TFunction } from "i18next";

/** 星期展示名 key（索引与 JS Date.getDay 一致：0=周日 … 6=周六） */
const DOW_KEYS = [
  "time.dow.0",
  "time.dow.1",
  "time.dow.2",
  "time.dow.3",
  "time.dow.4",
  "time.dow.5",
  "time.dow.6",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** cron 分/时/日/月/星期 五段解析（宽松，服务端 cron-parser 为准） */
function splitCron(cron: string): string[] {
  return cron.trim().split(/\s+/);
}

/**
 * cron 表达式的渲染层形状校验：5 段 + 仅允许合法字符（返回错误文案或 null）。
 * 权威校验在主进程 cron-parser；此处仅阻止明显非法输入并给即时提示。
 */
export function validateCronShape(cron: string, t: TFunction): string | null {
  const fields = splitCron(cron);
  if (fields.length !== 5) return t("schedule.cronFiveFields");
  if (!/^[0-9*,/\-?]+$/.test(fields.join(""))) return t("schedule.cronInvalidChars");
  return null;
}

/** 预设 → cron 表达式（time 为 { h, m }，dow 0-6 周日开头，dom 1-31） */
export function presetCron(
  preset: "hourly" | "daily" | "weekly" | "monthly",
  time: { h: number; m: number },
  dow?: number,
  dom?: number,
): string {
  const { h, m } = time;
  switch (preset) {
    case "hourly":
      return "0 * * * *";
    case "weekly":
      return `${m} ${h} * * ${dow ?? 1}`;
    case "monthly":
      return `${m} ${h} ${dom ?? 1} * *`;
    case "daily":
    default:
      return `${m} ${h} * * *`;
  }
}

/** 调度规则 → 人话文案（spec 缺失时兜底，兼容损坏数据） */
export function humanizeSchedule(spec: ScheduleSpec | undefined, t: TFunction): string {
  if (!spec) return t("schedule.missingSpec");
  if (spec.type === "once") {
    const at = new Date(spec.runAt);
    if (Number.isNaN(at.getTime())) return t("schedule.once");
    const mins = Math.round((at.getTime() - Date.now()) / 60000);
    if (mins > 0 && mins <= 90) return t("schedule.inMinutesOnce", { mins });
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    return t("schedule.onceAtDate", { month: at.getMonth() + 1, day: at.getDate(), time });
  }
  const fields = splitCron(spec.cron);
  if (fields.length !== 5) return t("schedule.customCron", { cron: spec.cron });
  const [m, h, dom, mon, dow] = fields as [string, string, string, string, string];
  const time = `${pad(Number(h) || 0)}:${pad(Number(m) || 0)}`;
  const isSingle = (f: string) => /^\d+$/.test(f) && !f.includes(",");

  if (mon !== "*" && isSingle(mon)) {
    if (dom !== "*" && isSingle(dom))
      return t("schedule.monthDayTime", { month: Number(mon), day: Number(dom), time });
    return t("schedule.monthTime", { month: Number(mon), time });
  }
  if (dow !== "*") {
    const name = isSingle(dow) ? t(DOW_KEYS[Number(dow) % 7] ?? "time.dow.0") : dow;
    return t("schedule.weeklyDayTime", { name, time });
  }
  if (dom !== "*" && isSingle(dom)) return t("schedule.monthlyDayTime", { day: Number(dom), time });
  if (m === "0" && h === "*") return t("schedule.hourlyZeroMin");
  if (h !== "*" && m !== "*" && m !== "*/" && isSingle(h)) {
    if (dom === "*" && mon === "*") return t("schedule.dailyTime", { time });
  }
  return t("schedule.customCron", { cron: spec.cron });
}

/** 运行时长 → "2 分 18 秒" */
export function formatDuration(ms: number | undefined, t: TFunction): string {
  if (ms == null) return "";
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return t("schedule.durSeconds", { count: total });
  const m = Math.floor(total / 60);
  const remS = total % 60;
  if (m < 60)
    return remS
      ? t("schedule.durMinutesSeconds", { m, s: remS })
      : t("schedule.durMinutes", { count: m });
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM
    ? t("schedule.durHoursMinutes", { h, m: remM })
    : t("schedule.durHours", { count: h });
}

/** 运行费用 + token → "¥0.23 · 1,240 tokens"（无数据返回 null；单位词已是英文，无需翻译） */
export function formatCost(usage: MessageUsage | undefined): string | null {
  if (!usage) return null;
  const tokens = usage.totalTokens ? usage.totalTokens.toLocaleString() : "";
  const total = usage.cost?.total;
  if (total == null) return tokens ? `${tokens} tokens` : null;
  const costStr = total >= 0.01 ? `¥${total.toFixed(2)}` : "<¥0.01";
  return tokens ? `${costStr} · ${tokens} tokens` : costStr;
}
