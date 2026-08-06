/**
 * ToolCallCard - 工具调用卡片（弱化，见 §0.4 / §6.6）。
 * 折叠态单行芯片：工具名 + 状态图标；展开态显示参数与输出（含 bash 增量）。
 */
import { useState } from "react";
import type { ToolBlock } from "../stores/sessionStore";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLoader,
  IconWrench,
  IconX,
} from "./icons";

interface ToolCallCardProps {
  block: ToolBlock;
}

function StatusIcon({ status }: { status: ToolBlock["status"] }) {
  if (status === "running" || status === "calling") {
    return <IconLoader className="animate-spin" size={11} strokeWidth={2.5} />;
  }
  if (status === "success") {
    return <IconCheck size={11} strokeWidth={3} />;
  }
  return <IconX size={11} strokeWidth={3} />;
}

const statusColor: Record<ToolBlock["status"], string> = {
  calling: "text-ink-3",
  running: "text-accent",
  success: "text-accent-strong",
  error: "text-danger",
};

/** 安全序列化：工具结果可能含循环引用或非 JSON 值，render 期间不能抛错 */
function safeStringify(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolCallCard({ block }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const name = block.toolName || "工具";
  const statusLabel =
    block.status === "calling"
      ? "调用中"
      : block.status === "running"
        ? "运行中"
        : block.status === "success"
          ? "完成"
          : "失败";

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 rounded-s bg-hover px-2 py-1 text-[11px] text-ink-2 transition hover:bg-active"
      >
        <IconWrench size={11} strokeWidth={2} className="text-ink-3" />
        <span className="font-medium">{name}</span>
        <span className={statusColor[block.status]}>
          <StatusIcon status={block.status} />
        </span>
        <span className="text-ink-3">· {statusLabel}</span>
        {expanded ? (
          <IconChevronDown size={10} strokeWidth={2} className="text-ink-3" />
        ) : (
          <IconChevronRight size={10} strokeWidth={2} className="text-ink-3" />
        )}
      </button>

      {expanded && (
        <div className="mt-1 ml-4 space-y-1.5 border-l border-line pl-3">
          {block.args !== undefined && (
            <div>
              <div className="text-[10px] text-ink-3">参数</div>
              <pre className="mt-0.5 overflow-x-auto rounded-s bg-hover px-2 py-1 text-[11px] text-ink-2">
                {safeStringify(block.args)}
              </pre>
            </div>
          )}

          {block.outputDelta && (
            <div>
              <div className="text-[10px] text-ink-3">输出</div>
              <pre className="mt-0.5 max-h-48 overflow-auto rounded-s bg-terminal px-2 py-1 text-[11px] leading-relaxed text-terminal-text">
                {block.outputDelta}
              </pre>
            </div>
          )}

          {!block.outputDelta && block.output !== undefined && block.output !== "" && (
            <div>
              <div className="text-[10px] text-ink-3">结果</div>
              <pre
                className={`mt-0.5 overflow-x-auto rounded-s px-2 py-1 text-[11px] ${
                  block.status === "error" ? "bg-danger/10 text-danger" : "bg-hover text-ink-2"
                }`}
              >
                {safeStringify(block.output)}
              </pre>
            </div>
          )}

          {block.error && <div className="text-[11px] text-danger">{block.error}</div>}
        </div>
      )}
    </div>
  );
}
