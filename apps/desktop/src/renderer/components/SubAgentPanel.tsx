/**
 * SubAgentPanel - 子 Agent 运行面板（内嵌于父 delegate 工具卡，类 pi 折叠卡片）。
 *
 * 展示子代理：专家标识 + 状态 + 委派任务 + 流式文本 + 子工具列表 + 结果/用量。
 * 数据源为 sessionStore.subAgents[taskId][subagentId]（subagent_* 事件驱动）。
 */
import { useEffect, useState } from "react";
import { useExpertCenterStore } from "../stores/expertCenterStore";
import type { SubAgentState } from "../stores/sessionStore";
import { expertIcon } from "./expert/ui";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLoader,
  IconWrench,
  IconX,
} from "./icons";
import { MarkdownText } from "./MarkdownText";

function statusLabel(status: SubAgentState["status"]): string {
  switch (status) {
    case "running":
      return "运行中";
    case "ok":
      return "完成";
    case "error":
      return "失败";
    case "aborted":
      return "已取消";
  }
}

/** 子工具调用行（折叠态单行：工具名 + 状态） */
function SubToolRow({ tool }: { tool: SubAgentState["tools"][number] }) {
  const running = tool.phase === "start";
  const failed = tool.phase === "end" && tool.error;
  return (
    <div className="flex items-center gap-[6px] rounded-s bg-paper px-[8px] py-[3px] text-[11.5px] text-ink-2">
      <IconWrench size={10} strokeWidth={2} className="shrink-0 text-ink-3" />
      <span className="truncate">{tool.toolName}</span>
      {running ? (
        <IconLoader size={10} className="animate-spin text-accent" />
      ) : failed ? (
        <IconX size={10} className="text-danger" />
      ) : (
        <IconCheck size={10} className="text-accent-strong" />
      )}
    </div>
  );
}

export function SubAgentPanel({ subagent }: { subagent: SubAgentState }) {
  const [expanded, setExpanded] = useState(false);
  const expertIconKey =
    useExpertCenterStore((s) => s.experts).find((e) => e.id === subagent.expertId)?.icon ?? "bot";
  const running = subagent.status === "running";
  // 运行中自动展开详情：让流式文本/子工具实时可见；结束后保持展开（可手动折叠）
  useEffect(() => {
    if (running) setExpanded(true);
  }, [running]);
  // 结束后的最终文本以 subagent_end.text 为准；运行中显示流式 delta
  const body = subagent.text ?? subagent.delta;

  return (
    <div className="rounded-s border border-accent-line/60 bg-accent-tint/20">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-[7px] px-[10px] py-[6px] text-left text-[12px] text-ink transition hover:bg-hover"
      >
        <span className="flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-[5px] bg-white text-accent">
          {expertIcon(expertIconKey)}
        </span>
        <span className="font-semibold text-accent-strong">{subagent.expertName}</span>
        {running ? (
          <IconLoader size={11} className="animate-spin text-accent" />
        ) : subagent.status === "ok" ? (
          <IconCheck size={11} className="text-accent-strong" />
        ) : (
          <IconX size={11} className="text-danger" />
        )}
        <span className="text-ink-3">· {statusLabel(subagent.status)}</span>
        <span className="flex-1" />
        {expanded ? (
          <IconChevronDown size={10} strokeWidth={2} className="text-ink-3" />
        ) : (
          <IconChevronRight size={10} strokeWidth={2} className="text-ink-3" />
        )}
      </button>

      {expanded && (
        <div className="space-y-[6px] px-[10px] pb-[8px]">
          {/* 委派任务 */}
          <div className="text-[11.5px] leading-[1.5] text-ink-3">{subagent.prompt}</div>

          {/* 流式/最终文本（markdown 渲染） */}
          {body ? (
            <div className="max-h-48 overflow-auto rounded-s bg-card px-[8px] py-[6px]">
              <MarkdownText content={body} />
            </div>
          ) : running ? (
            <div className="text-[12px] text-ink-3">等待子代理响应…</div>
          ) : null}

          {/* 子工具列表 */}
          {subagent.tools.length > 0 ? (
            <div className="flex flex-wrap gap-[5px]">
              {subagent.tools.map((tool) => (
                <SubToolRow key={tool.toolCallId} tool={tool} />
              ))}
            </div>
          ) : null}

          {/* 用量 */}
          {subagent.usage?.totalTokens ? (
            <div className="text-[11px] text-ink-3">token {subagent.usage.totalTokens}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
