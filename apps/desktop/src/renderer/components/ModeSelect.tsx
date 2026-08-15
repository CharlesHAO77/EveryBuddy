/**
 * ModeSelect - 执行模式下拉（自动 / 手动 / 计划），模型选择器式交互。
 *
 * 位于输入框右下、紧挨模型选择器。切「计划」即进入计划模式（调 plan-mode 扩展 toggle）；
 * 切走则退出。同时与 plan-status 同步：经 /plan 等其它路径开启/关闭计划模式时，
 * 下拉显示随之更新。手动/自动驱动主进程权限门（agent:set-mode）。
 */

import type { ExecutionMode } from "@everybuddy/ipc-contract";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSessionStore } from "../stores/sessionStore";
import { IconCheck, IconChevronDown, IconClipboardCheck, IconHand, IconZap } from "./icons";

const MODES: Array<{
  id: ExecutionMode;
  labelKey: string;
  hintKey: string;
  icon: ReactNode;
}> = [
  { id: "auto", labelKey: "mode.auto", hintKey: "mode.autoHint", icon: <IconZap size={13} /> },
  {
    id: "manual",
    labelKey: "mode.manual",
    hintKey: "mode.manualHint",
    icon: <IconHand size={13} />,
  },
  {
    id: "plan",
    labelKey: "mode.plan",
    hintKey: "mode.planHint",
    icon: <IconClipboardCheck size={13} />,
  },
];

export function ModeSelect({ taskId }: { taskId: string | null }) {
  const { t } = useTranslation();
  const storedMode = useSessionStore((s) => (taskId ? s.modes[taskId] : s.pendingMode));
  const setMode = useSessionStore((s) => s.setMode);
  const setPendingMode = useSessionStore((s) => s.setPendingMode);
  const planStatus = useSessionStore((s) =>
    taskId ? s.extensionStates[taskId]?.["plan-mode"] : undefined,
  );
  const planOn =
    planStatus?.state === "plan" ||
    planStatus?.state === "ready" ||
    planStatus?.state === "executing";

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 派生当前模式：计划真实开启时显示「计划」；否则直接采纳存储值。
  // 进入/退出计划均由 /plan 与下拉写回 modes[taskId]，按钮不再只依赖异步 extension_status 事件
  const effective: ExecutionMode = planOn ? "plan" : (storedMode ?? "auto");

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const select = (m: ExecutionMode) => {
    setOpen(false);
    if (m === effective) return;
    if (!taskId) {
      // 主页无任务：仅记 pendingMode，创建对话时由 WelcomeView 应用到新任务
      setPendingMode(m);
      return;
    }
    // 计划模式联动 plan-mode 扩展（避免重复 toggle）
    if (m === "plan" && !planOn) {
      void window.electronAPI.agent.extensionCommand({
        taskId,
        extension: "plan-mode",
        command: "toggle",
      });
    } else if (m !== "plan" && planOn) {
      void window.electronAPI.agent.extensionCommand({
        taskId,
        extension: "plan-mode",
        command: "toggle",
      });
    }
    setMode(taskId, m);
  };

  const current = MODES.find((x) => x.id === effective) ?? {
    id: "auto" as ExecutionMode,
    labelKey: "mode.auto",
    hintKey: "mode.autoHint",
    icon: <IconZap size={13} />,
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("mode.titleWithHint", { hint: t(current.hintKey) })}
        className={`flex items-center gap-[5px] rounded-s px-2 py-[5px] text-[12px] transition ${
          effective === "plan"
            ? "bg-accent-tint font-semibold text-accent-strong"
            : "bg-hover text-ink-2 hover:bg-active hover:text-ink"
        }`}
      >
        {current.icon}
        <span>{t(current.labelKey)}</span>
        <IconChevronDown size={10} strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-[6px] w-[180px] rounded-m border border-line bg-card py-1 shadow-pop">
          <div className="px-3 pb-1 pt-1 text-[11px] tracking-wide text-ink-3">
            {t("mode.title")}
          </div>
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => select(m.id)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition ${
                m.id === effective
                  ? "bg-accent-tint font-semibold text-accent-strong"
                  : "text-ink-2 hover:bg-hover"
              }`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {m.icon}
                <span className="shrink-0">{t(m.labelKey)}</span>
                <span className="truncate text-[11px] text-ink-3">{t(m.hintKey)}</span>
              </span>
              {m.id === effective && <IconCheck size={12} strokeWidth={2.5} className="shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
