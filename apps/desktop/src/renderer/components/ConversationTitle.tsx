import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../stores/sessionStore";

interface ConversationTitleProps {
  taskId: string;
  title: string;
}

/**
 * 对话标题（对话区标题栏拖动层内）：
 * 显示态为可点击按钮，titlebar-no-drag 从拖动区「抠出」以可交互；点击进入内联重命名，
 * 编辑态为 input（Enter 提交 / Esc 取消 / blur 提交），复用 sessionStore.renameTask。
 */
export function ConversationTitle({ taskId, title }: ConversationTitleProps) {
  const { t } = useTranslation();
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
    if (next && next !== title) renameTask(taskId, next);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        maxLength={100}
        // biome-ignore lint/a11y/noAutofocus: 重命名输入框需立即聚焦并全选，符合重命名惯例
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
        className="titlebar-no-drag w-[min(60%,380px)] min-w-0 rounded-sm border border-line-strong bg-card px-[8px] py-[2px] text-[16px] font-semibold text-ink outline-none focus:border-accent"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startRename}
      title={t("chat.renameTitle")}
      className="titlebar-no-drag -ml-[6px] flex min-w-0 items-center rounded-s px-[6px] py-[2px] text-[16px] font-semibold text-ink transition hover:bg-hover"
    >
      <span className="min-w-0 truncate">{title}</span>
    </button>
  );
}
