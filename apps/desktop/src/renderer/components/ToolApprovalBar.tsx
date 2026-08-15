/**
 * ToolApprovalBar - 工具权限确认提示条（手动模式下渲染在输入框正上方）。
 *
 * 显示待确认工具（bash 徽标 + 说明 + 完整命令/参数，可换行），提供「本会话总是允许」
 * 勾选与允许/拒绝。应答经 agent:approveTool 恢复主进程中被暂停的工具调用。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../stores/sessionStore";
import { IconCheck, IconShield } from "./icons";

/** 命令类参数（bash 等）直接展示 command；其余 JSON 化 */
function formatArgs(args: unknown): string {
  if (args && typeof args === "object" && !Array.isArray(args) && "command" in args) {
    const c = (args as { command: unknown }).command;
    if (typeof c === "string") return c;
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export function ToolApprovalBar({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  // 注意：selector 不能 `?? []` 兜底——每次调用都新建数组引用会让 useSyncExternalStore 判定快照变化而无限重渲染。
  // 直接取 undefined（稳定值），组件内再兜底。
  const approvals = useSessionStore((s) => s.pendingApprovals[taskId]);
  const removeToolApproval = useSessionStore((s) => s.removeToolApproval);
  const addAlwaysAllowedTool = useSessionStore((s) => s.addAlwaysAllowedTool);
  const [always, setAlways] = useState(false);

  const first = approvals?.[0];
  if (!first) return null;
  const a = first;

  const answer = (approved: boolean) => {
    if (approved && always) addAlwaysAllowedTool(taskId, a.toolName);
    void window.electronAPI.agent.approveTool({
      taskId,
      requestId: a.requestId,
      approved,
    });
    removeToolApproval(taskId, a.requestId);
    setAlways(false);
  };

  return (
    <div className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-line bg-card px-3 py-2.5 shadow-card">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
              a.isDangerous
                ? "border-accent-line bg-accent-tint text-accent-strong"
                : "border-line bg-hover text-ink-2"
            }`}
          >
            <IconShield size={11} />
            {a.toolName}
          </span>
          <span className="text-[11px] text-ink-3">{t("tool.manualApprovalNote")}</span>
        </div>
        <pre className="mt-1 max-h-[72px] overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed text-ink-2">
          {formatArgs(a.args)}
        </pre>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <button
          type="button"
          aria-pressed={always}
          onClick={() => setAlways((v) => !v)}
          className="flex cursor-pointer items-center gap-1.5 text-[12px] text-ink-2"
        >
          <span
            className={`flex h-[14px] w-[14px] items-center justify-center rounded-[4px] border ${
              always ? "border-accent bg-accent text-white" : "border-line-strong bg-card"
            }`}
          >
            {always && <IconCheck size={10} strokeWidth={3} />}
          </span>
          {t("tool.alwaysAllow")}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => answer(false)}
            className="rounded-s border border-line-strong bg-card px-3 py-1.5 text-[12.5px] font-semibold text-danger transition hover:border-danger"
          >
            {t("common.reject")}
          </button>
          <button
            type="button"
            onClick={() => answer(true)}
            className="rounded-s bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-accent-strong"
          >
            {t("common.allow")}
          </button>
        </div>
      </div>
    </div>
  );
}
