/**
 * expert/icons - 专家·技能·连接器 图标集（对齐 docs/demos/expert-skill-connector.html）。
 *
 * 统一线性风格：24 viewBox、stroke 1.8、round 端点、currentColor（由父级 text-* 控制）。
 * 每实体类别一个图标族：专家 briefcase/code/clipboard/palette/monitor，团队 users/bot/workflow，
 * 技能 sparkles，连接器 hub/folder/globe/database/puzzle。色相由卡片 ic-* tint 类决定。
 */
import type { ReactNode } from "react";

export interface ExIconProps {
  /** 边长，默认 18 */
  size?: number;
  /** 描边粗细，默认 1.8 */
  strokeWidth?: number;
  className?: string;
}

interface SvgProps extends ExIconProps {
  children: ReactNode;
}

function Svg({ size = 18, strokeWidth = 1.8, className, children }: SvgProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function icon(children: ReactNode) {
  return function Icon(props: ExIconProps) {
    return <Svg {...props}>{children}</Svg>;
  };
}

/* ── 专家分型 ── */
export const IconBriefcase = icon(
  <>
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M3 12h18" />
  </>,
);
export const IconCode = icon(
  <>
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </>,
);
export const IconClipboard = icon(
  <>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2" />
    <path d="M9 11h6" />
    <path d="M9 15h4" />
  </>,
);
export const IconPalette = icon(
  <>
    <path d="M12 2a10 10 0 0 0 0 20 2.5 2.5 0 0 0 2.5-2.5c0-.66-.26-1.26-.68-1.7a2.5 2.5 0 0 1 1.82-4.2H18a4 4 0 0 0 4-4 10 10 0 0 0-10-7.6z" />
    <circle cx="8" cy="10" r="1" />
    <circle cx="13" cy="7" r="1" />
    <circle cx="17" cy="11" r="1" />
  </>,
);
export const IconMonitor = icon(
  <>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8" />
    <path d="M12 17v4" />
  </>,
);

/* ── 专家 / 专家团 / 技能 / 连接器 tab ── */
export const IconUser = icon(
  <>
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </>,
);
export const IconUsers = icon(
  <>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);
export const IconSparkles = icon(
  <>
    <path d="M12 3l1.6 4.8L18 9l-4.4 1.2L12 15l-1.6-4.8L6 9l4.4-1.2z" />
    <path d="M19 14l.6 1.8 1.9-.7-1.9-.7-.6-1.8-.6 1.8-1.9.7 1.9.7z" />
  </>,
);
export const IconPlug = icon(
  <>
    <path d="M12 22v-5" />
    <path d="M9 8V2" />
    <path d="M15 8V2" />
    <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
  </>,
);

/* ── 连接器类型 ── */
export const IconHub = icon(
  <>
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="5" cy="5" r="1.8" />
    <circle cx="19" cy="5" r="1.8" />
    <circle cx="5" cy="19" r="1.8" />
    <circle cx="19" cy="19" r="1.8" />
    <path d="M6.6 6.6l3.2 3.2" />
    <path d="M17.4 6.6l-3.2 3.2" />
    <path d="M6.6 17.4l3.2-3.2" />
    <path d="M17.4 17.4l-3.2-3.2" />
  </>,
);
export const IconFolder = icon(
  <path d="M4 6a2 2 0 0 1 2-2h3.5l2 2.5H18a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />,
);
export const IconGlobe = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18" />
    <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
  </>,
);
export const IconDatabase = icon(
  <>
    <ellipse cx="12" cy="5" rx="8" ry="2.6" />
    <path d="M4 5v6c0 1.5 3.6 2.6 8 2.6s8-1.1 8-2.6V5" />
    <path d="M4 11v6c0 1.5 3.6 2.6 8 2.6s8-1.1 8-2.6v-6" />
  </>,
);
export const IconPuzzle = icon(
  <path d="M14 4a2 2 0 0 0-2 2v2H8a2 2 0 0 0-2 2v3H4a2 2 0 0 0 0 4h2v3a2 2 0 0 0 2 2h4v-2a2 2 0 0 1 4 0v2h4a2 2 0 0 0 2-2v-4h2a2 2 0 0 0 0-4h-2V10a2 2 0 0 0-2-2h-4V6a2 2 0 0 0-2-2z" />,
);

/* ── 专家团预留能力 ── */
export const IconBot = icon(
  <>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4" />
    <circle cx="12" cy="3.5" r="1" />
    <path d="M2 14h2" />
    <path d="M20 14h2" />
    <path d="M9 13v2" />
    <path d="M15 13v2" />
  </>,
);
export const IconWorkflow = icon(
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <path d="M10 6.5h4a2 2 0 0 1 2 2V14" />
  </>,
);

/* ── 工具图标 ── */
export const IconSearch = icon(
  <>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </>,
);
export const IconClose = icon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
);
export const IconPlus = icon(
  <>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </>,
);
export const IconWarn = icon(
  <>
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </>,
);
export const IconInfo = icon(
  <>
    <circle cx="12" cy="12" r="10" />
    <line x1="12" y1="16" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12.01" y2="8" />
  </>,
);
export const IconCheck = icon(<polyline points="20 6 9 17 4 12" />);
export const IconX = icon(
  <>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </>,
);
