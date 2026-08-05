/**
 * ToolCallCard - 工具调用卡片（弱化，见 §0.4 / §6.6）。
 * 折叠态单行芯片：工具名 + 状态图标；展开态显示参数与输出（含 bash 增量）。
 */
import { useState } from "react";
import type { ToolBlock } from "../stores/sessionStore";

interface ToolCallCardProps {
  block: ToolBlock;
}

function StatusIcon({ status }: { status: ToolBlock["status"] }) {
  if (status === "running" || status === "calling") {
    return (
      <svg
        className="animate-spin"
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
      >
        <path d="M21 12a9 9 0 11-6.219-8.56" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "success") {
    return (
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

const statusColor: Record<ToolBlock["status"], string> = {
  calling: "text-gray-400",
  running: "text-blue-500",
  success: "text-green-500",
  error: "text-red-500",
};

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
        className="flex items-center gap-1.5 rounded-md bg-[var(--surface-tab)] px-2 py-1 text-[11px] text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
        </svg>
        <span className="font-medium">{name}</span>
        <span className={statusColor[block.status]}>
          <StatusIcon status={block.status} />
        </span>
        <span className="text-[var(--text-muted)]">· {statusLabel}</span>
        {expanded && <span className="text-[var(--text-muted)]">▾</span>}
        {!expanded && <span className="text-[var(--text-muted)]">▸</span>}
      </button>

      {expanded && (
        <div className="mt-1 ml-4 space-y-1.5 border-l border-[var(--border-light)] pl-3">
          {block.args !== undefined && (
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">参数</div>
              <pre className="mt-0.5 overflow-x-auto rounded bg-[var(--surface-hover)] px-2 py-1 text-[11px] text-[var(--text-secondary)]">
                {typeof block.args === "string" ? block.args : JSON.stringify(block.args, null, 2)}
              </pre>
            </div>
          )}

          {block.outputDelta && (
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">输出</div>
              <pre className="mt-0.5 max-h-48 overflow-auto rounded bg-gray-900 px-2 py-1 text-[11px] leading-relaxed text-gray-100">
                {block.outputDelta}
              </pre>
            </div>
          )}

          {!block.outputDelta && block.output !== undefined && block.output !== "" && (
            <div>
              <div className="text-[10px] text-[var(--text-muted)]">结果</div>
              <pre
                className={`mt-0.5 overflow-x-auto rounded px-2 py-1 text-[11px] ${
                  block.status === "error"
                    ? "bg-red-50 text-red-600"
                    : "bg-[var(--surface-hover)] text-[var(--text-secondary)]"
                }`}
              >
                {typeof block.output === "string"
                  ? block.output
                  : JSON.stringify(block.output, null, 2)}
              </pre>
            </div>
          )}

          {block.error && <div className="text-[11px] text-red-500">{block.error}</div>}
        </div>
      )}
    </div>
  );
}
