/**
 * 自动化（定时任务）渲染层纯函数：调度文案 / cron 校验 / 时长与费用格式化。
 */

import type { MessageUsage, ScheduleSpec } from "@everybuddy/ipc-contract";

const DOW_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

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
export function validateCronShape(cron: string): string | null {
  const fields = splitCron(cron);
  if (fields.length !== 5) return "cron 需要 5 段：分 时 日 月 星期";
  if (!/^[0-9*,/\-?]+$/.test(fields.join(""))) return "包含非法字符（仅支持数字、* , / - ?）";
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
export function humanizeSchedule(spec?: ScheduleSpec): string {
  if (!spec) return "调度规则缺失";
  if (spec.type === "once") {
    const at = new Date(spec.runAt);
    if (Number.isNaN(at.getTime())) return "一次性";
    const mins = Math.round((at.getTime() - Date.now()) / 60000);
    if (mins > 0 && mins <= 90) return `${mins} 分钟后 · 一次性`;
    return `一次性 · ${at.getMonth() + 1}月${at.getDate()}日 ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }
  const fields = splitCron(spec.cron);
  if (fields.length !== 5) return `自定义 cron：${spec.cron}`;
  const [m, h, dom, mon, dow] = fields as [string, string, string, string, string];
  const time = `${pad(Number(h) || 0)}:${pad(Number(m) || 0)}`;
  const isSingle = (f: string) => /^\d+$/.test(f) && !f.includes(",");

  if (mon !== "*" && isSingle(mon)) {
    const monthName = `${Number(mon)}月`;
    if (dom !== "*" && isSingle(dom)) return `${monthName}${Number(dom)}日 ${time}`;
    return `${monthName} ${time}`;
  }
  if (dow !== "*") {
    const name = isSingle(dow) ? (DOW_NAMES[Number(dow) % 7] ?? dow) : dow;
    return `每周${name} ${time}`;
  }
  if (dom !== "*" && isSingle(dom)) return `每月${Number(dom)}日 ${time}`;
  if (m === "0" && h === "*") return "每小时 0 分";
  if (h !== "*" && m !== "*" && m !== "*/" && isSingle(h)) {
    if (dom === "*" && mon === "*") return `每天 ${time}`;
  }
  return `自定义 cron：${spec.cron}`;
}

/** 运行时长 → "2 分 18 秒" */
export function formatDuration(ms?: number): string {
  if (ms == null) return "";
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total} 秒`;
  const m = Math.floor(total / 60);
  const remS = total % 60;
  if (m < 60) return remS ? `${m} 分 ${remS} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM ? `${h} 小时 ${remM} 分` : `${h} 小时`;
}

/** 运行费用 + token → "¥0.23 · 1,240 tokens"（无数据返回 null） */
export function formatCost(usage?: MessageUsage): string | null {
  if (!usage) return null;
  const tokens = usage.totalTokens ? usage.totalTokens.toLocaleString() : "";
  const total = usage.cost?.total;
  if (total == null) return tokens ? `${tokens} tokens` : null;
  const costStr = total >= 0.01 ? `¥${total.toFixed(2)}` : "<¥0.01";
  return tokens ? `${costStr} · ${tokens} tokens` : costStr;
}
