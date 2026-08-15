/**
 * WorkflowRunCard - workflow 运行卡（绑定 workflow 团队的任务，随运行流式更新）。
 *
 * 数据源 sessionStore.workflowRuns[taskId]（workflow_* + subagent_* 事件驱动）：
 * 横向步骤链（专家名 + 状态圆点），点步骤展开该步骤的子 Agent 面板，底部汇总 + 总用量。
 * 运行态为内存态（reload 后消失，MVP 约定）。
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatCost, formatTokens } from "../billing";
import { useExpertCenterStore } from "../stores/expertCenterStore";
import { useSessionStore, type WorkflowStepState } from "../stores/sessionStore";
import { IconUsers } from "./expert/icons";
import { IconCheck, IconChevronDown, IconLoader, IconX } from "./icons";
import { MarkdownText } from "./MarkdownText";
import { SubAgentPanel } from "./SubAgentPanel";

function StepStatus({ status }: { status: WorkflowStepState["status"] }) {
  if (status === "running") return <IconLoader size={12} className="animate-spin text-accent" />;
  if (status === "ok") return <IconCheck size={12} className="text-accent-strong" />;
  if (status === "error") return <IconX size={12} className="text-danger" />;
  return <span className="h-[12px] w-[12px] rounded-full border border-line-strong" />;
}

export function WorkflowRunCard({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const run = useSessionStore((s) => s.workflowRuns[taskId]);
  // 选择器只取稳定引用（s.subAgents[taskId]），缺省空对象在组件体内派生——
  // 避免内联 `?? {}` 每次返回新引用触发 useSyncExternalStore 无限重渲染
  const subAgentsMap = useSessionStore((s) => s.subAgents[taskId]);
  const subAgents = subAgentsMap ?? {};
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const experts = useExpertCenterStore((s) => s.experts);

  if (!run) return null;

  // 点击节点：展开执行过程；再次点击关闭（运行中的步骤仍自动展开流式）
  const toggle = (stepId: string) =>
    setExpandedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }));

  const stepSubs = (step: WorkflowStepState) =>
    Object.values(subAgents).filter((sub) => sub.stepId === step.stepId);

  const expertName = (id: string) => experts.find((e) => e.id === id)?.name ?? id;

  // footer 用时：运行中按当前时间计
  const durationMs = (run.finishedAt ?? Date.now()) - run.startedAt;
  const duration = durationMs >= 0 ? Math.round(durationMs / 100) / 10 : 0;

  return (
    <div className="overflow-hidden rounded-[12px] border border-accent-line bg-card shadow-card">
      {/* 头部：工作流名 + 总状态 */}
      <div className="flex items-center gap-[8px] border-b border-line px-[14px] py-[9px]">
        <IconUsers size={14} className="text-accent" />
        <span className="text-[13px] font-semibold text-ink">{run.name}</span>
        {run.status === "running" ? (
          <IconLoader size={12} className="animate-spin text-accent" />
        ) : run.status === "ok" ? (
          <IconCheck size={12} className="text-accent-strong" />
        ) : (
          <IconX size={12} className="text-danger" />
        )}
        <span className="text-[12px] text-ink-3">
          {run.status === "running" ? "运行中" : run.status === "ok" ? "已完成" : "已结束"}
        </span>
      </div>

      {/* 步骤链：编号节点卡片 + 箭头连接，明显分隔 */}
      <div className="flex flex-wrap items-stretch gap-x-[8px] gap-y-[10px] px-[14px] py-[12px]">
        {run.steps.map((step, i) => (
          <div key={step.stepId} className="flex items-stretch">
            {i > 0 ? (
              <span className="flex items-center pr-[6px] text-[16px] text-accent-line">→</span>
            ) : null}
            <button
              type="button"
              onClick={() => toggle(step.stepId)}
              className={`flex min-w-[126px] flex-col gap-[7px] rounded-[12px] border-2 px-[14px] py-[10px] text-left transition active:scale-[0.98] ${
                step.status === "running"
                  ? "border-accent bg-accent-tint shadow-card"
                  : step.status === "ok"
                    ? "border-accent-line bg-card hover:border-accent"
                    : "border-line bg-paper opacity-75 hover:opacity-100"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[10px] font-bold ${
                    step.status === "running"
                      ? "bg-accent text-white"
                      : step.status === "ok"
                        ? "bg-accent-tint text-accent-strong"
                        : "bg-hover text-ink-3"
                  }`}
                >
                  {i + 1}
                </span>
                <StepStatus status={step.status} />
              </div>
              <span className="truncate text-[12.5px] font-semibold text-ink">{step.stepId}</span>
              <span className="truncate text-[11px] text-ink-3">
                {step.expertIds.map((id) => expertName(id)).join(" / ") || "—"}
              </span>
            </button>
          </div>
        ))}
      </div>

      {/* 步骤明细：每个展开节点 = 独立卡片（头部可折叠 + 分隔明显），运行中的步骤自动展开流式 */}
      {run.steps.some((s) => expandedSteps[s.stepId] || s.status === "running") ? (
        <div className="flex flex-col gap-[10px] border-t border-line px-[14px] py-[12px]">
          {run.steps.map((step, i) =>
            expandedSteps[step.stepId] || step.status === "running" ? (
              <div
                key={step.stepId}
                className={`overflow-hidden rounded-[12px] border bg-paper ${
                  step.status === "running" ? "border-accent" : "border-line"
                }`}
              >
                {/* 节点头部：序号 + 步骤名 + 专家 + 状态 + 折叠 */}
                <button
                  type="button"
                  onClick={() => toggle(step.stepId)}
                  className="flex w-full items-center gap-[8px] border-b border-line bg-card px-[12px] py-[8px] text-left transition hover:bg-hover"
                >
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      step.status === "running"
                        ? "bg-accent text-white"
                        : step.status === "ok"
                          ? "bg-accent-tint text-accent-strong"
                          : "bg-hover text-ink-3"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="text-[12.5px] font-semibold text-ink">{step.stepId}</span>
                  <span className="truncate text-[11px] text-ink-3">
                    {step.expertIds.map((id) => expertName(id)).join(" / ") || "—"}
                  </span>
                  <span className="flex-1" />
                  <StepStatus status={step.status} />
                  <IconChevronDown size={11} strokeWidth={2} className="text-ink-3" />
                </button>
                {/* 节点内容：子 agent 面板 + 步骤输出 */}
                <div className="space-y-[8px] p-[10px]">
                  {stepSubs(step).map((sub) => (
                    <SubAgentPanel key={sub.subagentId} subagent={sub} />
                  ))}
                  {step.output ? (
                    <div className="max-h-48 overflow-auto rounded-s bg-card px-[8px] py-[6px]">
                      <MarkdownText content={step.output} />
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null,
          )}
        </div>
      ) : null}

      {/* 汇总（markdown 渲染） */}
      {run.summary ? (
        <div className="border-t border-line px-[14px] py-[10px]">
          <div className="mb-[4px] flex items-center gap-[6px] text-[12px] font-semibold text-ink">
            <IconChevronDown size={12} className="text-ink-3" />
            汇总
          </div>
          <MarkdownText content={run.summary} />
        </div>
      ) : null}

      {run.error ? (
        <div className="border-t border-line px-[14px] py-[8px] text-[12px] text-danger">
          {run.error}
        </div>
      ) : null}

      {/* footer：token 用量 / 费用 / 耗时（含全部子 agent） */}
      <div className="flex flex-wrap items-center gap-[8px] border-t border-line px-[14px] py-[7px] text-[11px] text-ink-3">
        {run.usage ? (
          <span className="tabular-nums">
            {t("billing.runTokens", {
              input: formatTokens(run.usage.input),
              output: formatTokens(run.usage.output),
              total: formatTokens(run.usage.totalTokens),
            })}
            {run.usage.cost && run.usage.cost.total > 0
              ? ` · ${formatCost(run.usage.cost.total)}`
              : ""}
          </span>
        ) : null}
        <span className="tabular-nums">{t("billing.runDuration", { seconds: duration })}</span>
      </div>
    </div>
  );
}
