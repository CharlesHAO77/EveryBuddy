/**
 * icons - 全应用统一图标模块（Lucide/Feather 风格）。
 *
 * 约定：
 * - 24 viewBox，stroke="currentColor"，默认 16px / 2px 描边，round 端点
 * - 颜色一律由父级 text-* 类控制，图标自身不写死颜色（个别点睛元素除外，如 IconSearch 的青碧内圈用 var(--accent) 语义 token）
 * - 填充型图标（IconStop / IconMoreVertical / IconZap）用 fill="currentColor"
 */

import type { ReactNode } from "react";

export interface IconProps {
  /** 边长，默认 16 */
  size?: number;
  /** 描边粗细，默认 2（填充型图标忽略） */
  strokeWidth?: number;
  className?: string;
  /** 无障碍标题；不传则 aria-hidden */
  title?: string;
}

interface SvgProps extends IconProps {
  children: ReactNode;
  /** 填充型图标（stop、更多点） */
  fill?: boolean;
}

function Svg({ size = 16, strokeWidth = 2, className, title, children, fill }: SvgProps) {
  const labelled = typeof title === "string" && title.length > 0;
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: 装饰性图标已 aria-hidden；带 title 的图标渲染了 <title>，规则无法静态验证条件分支
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={labelled ? undefined : true}
      role={labelled ? "img" : undefined}
    >
      {labelled ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* ── 侧栏 ── */

export function IconPanelLeftClose(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="9" y1="3" x2="9" y2="21" />
    </Svg>
  );
}

export function IconPanelLeftOpen(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="15" y1="3" x2="15" y2="21" />
    </Svg>
  );
}

export function IconPlus(props: IconProps) {
  return (
    <Svg size={18} strokeWidth={2.2} {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </Svg>
  );
}

export function IconFile(props: IconProps) {
  return (
    <Svg size={14} {...props}>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Svg>
  );
}

export function IconSearch({ ring = true, ...props }: IconProps & { ring?: boolean }) {
  return (
    <Svg size={18} {...props}>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
      {ring && (
        <circle
          cx="11"
          cy="11"
          r="4.2"
          fill="none"
          stroke="var(--accent)"
          strokeWidth={Math.max(1.5, (props.strokeWidth ?? 2) * 0.85)}
        />
      )}
    </Svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </Svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </Svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z" />
      <line x1="5" y1="3" x2="5" y2="6" />
      <line x1="3" y1="5" x2="6" y2="5" />
    </Svg>
  );
}

export function IconZap(props: IconProps) {
  return (
    <Svg size={18} {...props} fill>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </Svg>
  );
}

/* ── 方向 ── */

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="6 9 12 15 18 9" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="9 18 15 12 9 6" />
    </Svg>
  );
}

/* ── 输入区 ── */

export function IconMic(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path d="M5 10v1a7 7 0 0014 0v-1" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </Svg>
  );
}

export function IconArrowUp(props: IconProps) {
  return (
    <Svg {...props}>
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </Svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <Svg {...props} fill>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </Svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </Svg>
  );
}

/* ── 通用 ── */

export function IconFolder(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <Svg size={18} {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </Svg>
  );
}

export function IconAlertTriangle(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </Svg>
  );
}

export function IconMoreVertical(props: IconProps) {
  return (
    <Svg {...props} fill>
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </Svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <Svg {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </Svg>
  );
}

/* ── 消息流 ── */

export function IconWrench(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
    </Svg>
  );
}

export function IconLoader(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </Svg>
  );
}

export function IconLightbulb(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.1V18h6v-1.2c0-.8.4-1.6 1-2.1A7 7 0 0012 2z" />
    </Svg>
  );
}
