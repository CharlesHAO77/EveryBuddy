/**
 * RightPanel - 右侧面板（待办 + 未来预览区）。
 *
 * 视图注册表便于扩展（后续加制品 md 编辑器、工作区文件等）。待办视图
 * 展示 plan-mode 的三态步骤（完成删除线 / 当前项高亮 / 待执行）与 todo 进度。
 * 视觉对齐 Sidebar（bg-paper-deep + border-l）；可折叠到 28px 窄条。
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";
import {
  IconClipboardCheck,
  IconEye,
  IconFile,
  IconPanelRightClose,
  IconPanelRightOpen,
} from "./icons";

type RightPanelViewId = "todo-plan" | "files" | "preview";

const VIEWS: Array<{ id: RightPanelViewId; label: string; icon: ReactNode }> = [
  { id: "todo-plan", label: "待办", icon: <IconClipboardCheck size={12} /> },
  { id: "files", label: "文件", icon: <IconFile size={12} /> },
  { id: "preview", label: "预览", icon: <IconEye size={12} /> },
];

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center text-[12.5px] text-ink-3">
      {text}
    </div>
  );
}

function ComingSoon() {
  return <Empty text="敬请期待" />;
}

/** 计划步骤三态：已完成（删除线）/ 当前执行项（强调条 + 浅绿底）/ 待执行 */
function TodoPlanView() {
  const taskId = useSessionStore((s) => s.currentTaskId);
  const plan = useSessionStore((s) =>
    taskId ? s.extensionStates[taskId]?.["plan-mode"] : undefined,
  );
  const todo = useSessionStore((s) => (taskId ? s.extensionStates[taskId]?.todo : undefined));

  const planOn = plan?.state === "plan" || plan?.state === "ready" || plan?.state === "executing";
  const showTodo = Boolean(todo?.value || (todo?.lines?.length ?? 0) > 0);

  if (!taskId) return <Empty text="选择或新建对话查看计划 / 待办" />;

  // 解析步骤三态：首个未完成项视为 current
  const lines = plan?.lines ?? [];
  let seenCurrent = false;
  const doneCount = lines.filter((l) => l.startsWith("☑")).length;
  const steps = lines.map((l) => {
    const done = l.startsWith("☑");
    let state: "done" | "current" | "pending" = done ? "done" : "pending";
    if (!done && !seenCurrent) {
      state = "current";
      seenCurrent = true;
    }
    return { text: l.replace(/^[☑☐]\s*/, ""), state };
  });

  const executing = plan?.state === "executing";

  const executePlan = () => {
    if (!taskId) return;
    void window.electronAPI.agent.extensionCommand({
      taskId,
      extension: "plan-mode",
      command: "execute",
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {planOn && (
        <>
          <div className="flex items-center justify-between rounded-m border border-line bg-card px-3 py-2 shadow-card">
            <span className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-ink">
              <IconClipboardCheck size={14} className="shrink-0" />
              <span className="truncate">{executing ? "计划执行中" : "计划已就绪"}</span>
            </span>
            {steps.length > 0 && (
              <span className="shrink-0 rounded-full bg-accent-tint px-2 py-0.5 text-[10.5px] font-semibold text-accent-strong">
                {executing ? `${doneCount}/${steps.length}` : "等待执行"}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-0.5">
            {steps.map((s) => (
              <div
                key={s.text}
                className={`flex items-start gap-2 rounded-s border-l-2 px-2 py-1 text-[12px] leading-snug ${
                  s.state === "current"
                    ? "border-accent bg-accent-tint font-semibold text-ink"
                    : "border-transparent"
                }`}
              >
                <span
                  className={`shrink-0 text-[11px] leading-[1.6] ${
                    s.state === "done"
                      ? "text-accent"
                      : s.state === "current"
                        ? "text-accent"
                        : "text-ink-3"
                  }`}
                >
                  {s.state === "done" ? "☑" : s.state === "current" ? "▸" : "☐"}
                </span>
                <span
                  className={
                    s.state === "done"
                      ? "text-ink-3 line-through"
                      : s.state === "pending"
                        ? "text-ink-2"
                        : "text-ink"
                  }
                >
                  {s.text}
                </span>
              </div>
            ))}
          </div>
          {plan?.state === "ready" && (
            <button
              type="button"
              onClick={executePlan}
              className="w-full rounded-s bg-accent py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-accent-strong active:scale-[0.98]"
            >
              执行计划
            </button>
          )}
        </>
      )}

      {showTodo && (
        <>
          {planOn && <hr className="border-line" />}
          <div className="flex items-center gap-2 rounded-m border border-line bg-card px-3 py-2 text-[12px] text-ink-2 shadow-card">
            <span>📝</span>
            <span className="truncate">{todo?.value ?? "待办"}</span>
          </div>
        </>
      )}

      {!planOn && !showTodo && <Empty text="开启计划模式后这里显示计划步骤" />}
    </div>
  );
}

export function RightPanel() {
  const open = useUIStore((s) => s.rightPanelOpen);
  const setOpen = useUIStore((s) => s.setRightPanelOpen);
  const [view, setView] = useState<RightPanelViewId>("todo-plan");

  if (!open) {
    return (
      <div className="flex h-full w-[28px] shrink-0 flex-col items-center border-l border-line bg-paper-deep">
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="打开右侧面板"
          className="mt-2 flex h-7 w-7 items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
        >
          <IconPanelRightOpen size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full w-[250px] shrink-0 flex-col border-l border-line bg-paper-deep">
      <div className="flex items-center gap-1 px-3 pb-1 pt-2.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            title={v.label}
            className={`flex flex-1 items-center justify-center gap-1 rounded-s px-1 py-1.5 text-[11.5px] transition ${
              view === v.id
                ? "bg-card font-semibold text-ink shadow-card"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {v.icon}
            {v.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="收起"
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
        >
          <IconPanelRightClose size={14} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
        {view === "todo-plan" ? <TodoPlanView /> : <ComingSoon />}
      </div>
    </div>
  );
}
