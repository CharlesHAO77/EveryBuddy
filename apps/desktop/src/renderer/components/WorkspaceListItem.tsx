import type { ReactNode } from "react";
import { ActionMenu } from "./ActionMenu";

const FolderIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="shrink-0"
  >
    <title>空间</title>
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const ChevronDownIcon = ({ open }: { open?: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="2"
    strokeLinecap="round"
    className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
  >
    <title>{open ? "折叠" : "展开"}</title>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

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
        className="group flex h-[30px] w-full cursor-pointer items-center gap-[8px] rounded-[4px] px-[10px] text-[13px] text-[#333] transition hover:bg-[#f0f0f0]"
      >
        <FolderIcon />
        <span className="flex-1 truncate text-left">{name}</span>
        <ActionMenu items={[{ label: "移除空间", danger: true, onSelect: onRemoveRequest }]} />
        {/* chevron hover 时让位给 ⋯ 按钮 */}
        <span className="group-hover:hidden">
          <ChevronDownIcon open={open} />
        </span>
      </div>
      {open && children}
    </div>
  );
}
