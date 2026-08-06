import { useRef, useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { ActionMenu } from "./ActionMenu";

interface TaskListItemProps {
  id: string;
  title: string;
  time: string;
  active: boolean;
  /** 空间下任务使用（左侧缩进） */
  indent?: boolean;
  onSelect: (id: string) => void;
  onDeleteRequest: (id: string, title: string) => void;
}

/**
 * 侧边栏单个任务行：选中态 / 时间戳 / hover ⋯ 菜单（重命名、删除）/ 内联重命名。
 * 临时任务与空间下任务共用（同一套处理逻辑）。
 * 根节点用 div + onClick 而非 button：内部含 ⋯ 按钮与 input，不能嵌套 button。
 */
export function TaskListItem({
  id,
  title,
  time,
  active,
  indent = false,
  onSelect,
  onDeleteRequest,
}: TaskListItemProps) {
  const renameTask = useSessionStore((s) => s.renameTask);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Esc 取消后 blur 不再提交
  const cancelledRef = useRef(false);

  const startRename = () => {
    cancelledRef.current = false;
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    const next = draft.trim();
    // 空串/未修改：视为取消，不调 IPC
    if (next && next !== title) renameTask(id, next);
    setEditing(false);
  };

  if (editing) {
    return (
      <div
        className={`flex w-full items-center rounded-s px-[10px] py-[6px] ${
          indent ? "pl-[32px]" : ""
        } ${active ? "bg-active" : ""}`}
      >
        <input
          type="text"
          value={draft}
          maxLength={100}
          // biome-ignore lint/a11y/noAutofocus: 重命名输入框需立即聚焦并全选，符合文件管理器重命名惯例
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              cancelledRef.current = true;
              setEditing(false);
            }
          }}
          onBlur={() => {
            if (!cancelledRef.current) commit();
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="w-full rounded-sm border border-line-strong bg-card px-[4px] py-[1px] text-[13px] text-ink outline-none focus:border-accent"
        />
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: 行内含 ⋯ 按钮等嵌套交互元素，无法用 button
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect(id);
      }}
      className={`group flex w-full cursor-pointer items-center justify-between gap-[6px] rounded-s px-[10px] py-[6px] text-left transition ${
        indent ? "pl-[32px]" : ""
      } ${active ? "bg-active" : "hover:bg-hover"}`}
    >
      <span className={`truncate text-[13px] ${active ? "font-medium text-ink" : "text-ink-2"}`}>
        {title}
      </span>
      {/* 时间戳 hover 时让位给 ⋯ 按钮 */}
      <span className="shrink-0 text-[12px] text-ink-3 group-hover:hidden">{time}</span>
      <ActionMenu
        items={[
          { label: "重命名", onSelect: startRename },
          { label: "删除", danger: true, onSelect: () => onDeleteRequest(id, title) },
        ]}
      />
    </div>
  );
}
