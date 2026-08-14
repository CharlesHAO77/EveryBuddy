/**
 * expert/ui - 专家中心共享展示组件（对齐 demo HTML 的 ic-* tint 色板）。
 */
import type { ReactNode } from "react";
import {
  IconBot,
  IconBriefcase,
  IconClipboard,
  IconCode,
  IconDatabase,
  IconFolder,
  IconGlobe,
  IconHub,
  IconMonitor,
  IconPalette,
  IconPlug,
  IconPuzzle,
  IconSparkles,
  IconUser,
  IconUsers,
  IconWorkflow,
  IconX,
} from "./icons";

/** 实体色调类：bg=tint 底 / color=主色 */
export type IconTone = "accent" | "warn" | "info" | "purple" | "neutral";

export const TONE_CLASS: Record<IconTone, string> = {
  accent: "bg-accent-tint text-accent",
  warn: "bg-warn-tint text-warn",
  info: "bg-info-tint text-info",
  purple: "bg-purple-tint text-purple",
  neutral: "bg-hover text-ink-2",
};

/** 图标注册表（按 icon key） */
const EXPERT_ICONS: Record<string, ReactNode> = {
  briefcase: <IconBriefcase />,
  code: <IconCode />,
  clipboard: <IconClipboard />,
  palette: <IconPalette />,
  monitor: <IconMonitor />,
  users: <IconUsers />,
  sparkles: <IconSparkles />,
  hub: <IconHub />,
  folder: <IconFolder />,
  globe: <IconGlobe />,
  database: <IconDatabase />,
  puzzle: <IconPuzzle />,
  bot: <IconBot />,
  workflow: <IconWorkflow />,
  user: <IconUser />,
  plug: <IconPlug />,
};

export function expertIcon(name?: string): ReactNode {
  return EXPERT_ICONS[name ?? ""] ?? <IconSparkles />;
}

/** 带 tint 底的图标方块（卡片 sm / 卡片 lg / 弹层头部 xl） */
export function IconTile({
  icon,
  tone,
  size = "lg",
}: {
  icon: ReactNode;
  tone: IconTone;
  size?: "sm" | "lg" | "xl";
}) {
  const box =
    size === "xl"
      ? "h-[52px] w-[52px] rounded-[13px]"
      : size === "lg"
        ? "h-[46px] w-[46px] rounded-[12px]"
        : "h-[34px] w-[34px] rounded-[9px]";
  return (
    <div className={`flex shrink-0 items-center justify-center ${box} ${TONE_CLASS[tone]}`}>
      {size === "lg" ? icon : <span className="scale-[0.75]">{icon}</span>}
    </div>
  );
}

/** 来源徽章（内置/自定义/已安装/项目级/全局） */
const SRC_LABEL: Record<string, string> = {
  builtin: "内置",
  custom: "自定义",
  installed: "已安装",
  project: "项目级",
  global: "全局",
};

const SRC_CLASS: Record<string, string> = {
  builtin: "bg-active text-ink-2",
  custom: "bg-accent-tint text-accent-strong",
  installed: "bg-warn-tint text-warn",
  project: "bg-info-tint text-info",
  global: "bg-active text-ink-2",
};

export function SourceBadge({ source }: { source: string }) {
  return (
    <span
      className={`rounded-[6px] px-[8px] py-[2px] text-[11px] font-semibold ${SRC_CLASS[source] ?? "bg-active text-ink-2"}`}
    >
      {SRC_LABEL[source] ?? source}
    </span>
  );
}

/** 类型徽章（连接器） */
export function TypeBadge({ label }: { label: string }) {
  return (
    <span className="rounded-[6px] bg-paper-deep px-[8px] py-[2px] text-[11px] font-semibold text-ink-2">
      {label}
    </span>
  );
}

/** 连接器状态点 */
const ST_CLASS: Record<string, string> = {
  connected: "text-accent",
  reserved: "text-warn",
  disconnected: "text-ink-3",
  error: "text-danger",
};

export const STATUS_LABEL: Record<string, string> = {
  connected: "已连接",
  reserved: "已注册·待激活",
  disconnected: "未连接",
  error: "连接异常",
};

export function StatusDot({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-[6px] text-[12px] font-semibold ${ST_CLASS[status] ?? "text-ink-3"}`}
    >
      <span className="h-[7px] w-[7px] rounded-full bg-current" />
      {label}
    </span>
  );
}

/** 标签 chip（纯展示） */
export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-line bg-paper px-[9px] py-[2px] text-[12px] text-ink-2">
      {children}
    </span>
  );
}

/** 可删除 chip（编辑态：文本 + 移除按钮） */
export function ChipRemovable({
  children,
  onRemove,
}: {
  children: ReactNode;
  onRemove?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-[6px] rounded-full border border-accent-line bg-accent-tint px-[10px] py-[4px] text-[13px] text-accent-strong">
      {children}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="opacity-55 transition hover:opacity-100"
        >
          <IconX size={12} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  );
}

/** 开关 */
export function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[40px] rounded-full transition ${on ? "bg-accent" : "bg-line-strong"}`}
    >
      <span
        className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition ${on ? "left-[20px]" : "left-[2px]"}`}
      />
    </button>
  );
}

/** 表单区块标题 + 提示 */
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-[20px] first:mt-0">
      <div className="mb-[9px] text-[13px] font-semibold tracking-[0.05em] text-ink-2">{label}</div>
      {children}
      {hint ? <p className="mt-[7px] text-[13px] leading-[1.6] text-ink-3">{hint}</p> : null}
    </div>
  );
}

/** 提示卡（预留 / 已接入） */
export function Note({
  tone,
  icon,
  title,
  children,
}: {
  tone: "warn" | "info";
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  const cls =
    tone === "warn"
      ? "border-warn-line bg-warn-tint text-warn"
      : "border-info-line bg-info-tint text-info";
  return (
    <div className={`flex items-start gap-[12px] rounded-[12px] border p-[14px] ${cls}`}>
      <span className="mt-[2px] shrink-0">{icon}</span>
      <div className="text-[14px] leading-[1.7]">
        <span className="font-bold">{title}</span>
        {children ? <span className="block opacity-85">{children}</span> : null}
      </div>
    </div>
  );
}

/** 通用表单控件 */
export function TextInput({
  value,
  onChange,
  placeholder,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full rounded-[10px] border border-line bg-card px-[14px] py-[10px] text-[15px] text-ink shadow-card transition focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      }`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  rows = 4,
  mono = false,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className={`w-full rounded-[10px] border border-line bg-card px-[14px] py-[10px] text-[13.5px] leading-[1.7] text-ink shadow-card transition focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint ${
        mono ? "font-mono" : ""
      }`}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`w-full rounded-[10px] border border-line bg-card px-[12px] py-[10px] text-[15px] text-ink shadow-card transition focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint ${
        disabled ? "cursor-not-allowed opacity-50" : ""
      }`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** 按钮 */
export const btnPrimary =
  "inline-flex items-center gap-[6px] rounded-[8px] bg-accent px-[16px] h-[38px] text-[15px] font-semibold text-white transition hover:bg-accent-strong active:scale-[0.98]";
export const btnGhost =
  "inline-flex items-center gap-[6px] rounded-[8px] border border-line-strong bg-card px-[16px] h-[38px] text-[15px] font-semibold text-ink-2 transition hover:bg-hover hover:text-ink active:scale-[0.98]";
export const btnDanger =
  "inline-flex items-center gap-[6px] rounded-[8px] border border-danger/30 bg-card px-[16px] h-[38px] text-[15px] font-semibold text-danger transition hover:bg-danger/10 active:scale-[0.98]";
