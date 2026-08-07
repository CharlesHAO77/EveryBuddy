import type { ReactNode } from "react";
import { ActionMenu } from "./ActionMenu";
import { IconChevronDown, IconFolder } from "./icons";

interface WorkspaceListItemProps {
  name: string;
  open: boolean;
  onToggle: () => void;
  onRemoveRequest: () => void;
  /** 展开时渲染的子任务列表（由 Sidebar 传入） */
  children?: ReactNode;
}

/**
 * 侧边栏单个空间行：展开/折叠 + hover ⋯ 菜单（移除空间）。
 * 根节点用 div + onClick 而非 button：内部含 ⋯ 按钮，不能嵌套 button。
 */
export function WorkspaceListItem({
  name,
  open,
  onToggle,
  onRemoveRequest,
  children,
}: WorkspaceListItemProps) {
  return (
    <div>
      {/* biome-ignore lint/a11y/useSemanticElements: 行内含 ⋯ 按钮等嵌套交互元素，无法用 button */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
        className="group flex h-[30px] w-full cursor-pointer items-center gap-[8px] rounded-s px-[10px] text-[14px] text-ink-2 transition hover:bg-hover"
      >
        <IconFolder size={14} title="空间" className="shrink-0 text-ink-3" />
        <span className="flex-1 truncate text-left">{name}</span>
        <ActionMenu items={[{ label: "移除空间", danger: true, onSelect: onRemoveRequest }]} />
        {/* chevron hover 时让位给 ⋯ 按钮 */}
        <span className="text-ink-3 group-hover:hidden">
          <IconChevronDown
            size={12}
            strokeWidth={2}
            title={open ? "折叠" : "展开"}
            className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </span>
      </div>
      {open && children}
    </div>
  );
}
