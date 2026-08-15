/**
 * ToolCallCard - 工具调用卡片（弱化，见 §0.4 / §6.6）。
 * 折叠态单行芯片：工具名 + 状态图标；展开态分节显示参数/输出/结果，各带复制按钮。
 */
import type { TFunction } from "i18next";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ToolBlock, useSessionStore } from "../stores/sessionStore";
import { CopyButton } from "./CopyButton";
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLoader,
  IconWrench,
  IconX,
} from "./icons";
import { SubAgentPanel } from "./SubAgentPanel";

interface ToolCallCardProps {
  block: ToolBlock;
  /** 父任务 id（按 parentToolCallId 查找内嵌的子 Agent 面板） */
  taskId: string;
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

type ToolResultBlock =
  | { type: "image"; data: string; mimeType?: string }
  | { type: "text"; text: string };

/**
 * 从工具结果 { content: [...], details } 提取可渲染的文本/图片块。
 * 返回 null 表示不是标准的 content 结构（走 JSON 展示兜底）。
 */
function extractResultBlocks(output: unknown): {
  blocks: ToolResultBlock[];
  paths?: string[];
} | null {
  if (!output || typeof output !== "object") return null;
  const obj = output as { content?: unknown; details?: { paths?: unknown } };
  if (!Array.isArray(obj.content)) return null;

  const blocks: ToolResultBlock[] = [];
  for (const c of obj.content) {
    if (!c || typeof c !== "object") continue;
    const block = c as { type?: unknown; data?: unknown; mimeType?: unknown; text?: unknown };
    if (block.type === "image" && typeof block.data === "string" && block.data.length > 0) {
      blocks.push({
        type: "image",
        data: block.data,
        mimeType: typeof block.mimeType === "string" ? block.mimeType : undefined,
      });
    } else if (block.type === "text" && typeof block.text === "string") {
      blocks.push({ type: "text", text: block.text });
    }
  }
  if (blocks.length === 0) return null;

  const rawPaths = obj.details?.paths;
  const paths = Array.isArray(rawPaths)
    ? rawPaths.filter((p): p is string => typeof p === "string")
    : undefined;
  return { blocks, paths: paths && paths.length > 0 ? paths : undefined };
}

/** 工具结果复制文本：文本块逐条拼接、路径列出、图片只记数量（不复制兆字节 base64） */
function serializeToolResultForCopy(output: unknown, t: TFunction): string {
  const parsed = extractResultBlocks(output);
  if (!parsed) return safeStringify(output);
  const lines: string[] = [];
  if (parsed.paths?.length) lines.push(...parsed.paths.map((p) => `📎 ${p}`));
  let imageCount = 0;
  for (const b of parsed.blocks) {
    if (b.type === "text") lines.push(b.text);
    else imageCount += 1;
  }
  if (imageCount > 0) lines.push(t("tool.imageCopyNote", { count: imageCount }));
  return lines.join("\n");
}

/** 工具结果主体：图片块渲染 <img>，文本块渲染文本，其余回退 JSON */
function ToolResultBody({ output }: { output: unknown }) {
  const { t } = useTranslation();
  const parsed = extractResultBlocks(output);
  if (!parsed) {
    return (
      <pre className="mt-0.5 overflow-x-auto rounded-s bg-hover px-2 py-1 text-[12px] text-ink-2">
        {safeStringify(output)}
      </pre>
    );
  }
  return (
    <div className="mt-0.5 space-y-1.5">
      {parsed.paths && (
        <div className="overflow-x-auto rounded-s bg-hover px-2 py-1 text-[12px] text-ink-2">
          {parsed.paths.map((p) => (
            <div key={p} className="truncate">
              📎 {p}
            </div>
          ))}
        </div>
      )}
      {parsed.blocks.map((b, i) => {
        // 工具结果块执行后静态不变，索引即可作 key
        const key = i;
        if (b.type === "image") {
          return (
            <img
              key={key}
              src={`data:${b.mimeType ?? "image/png"};base64,${b.data}`}
              alt={t("tool.generatedImage")}
              className="max-h-64 rounded-s border border-line bg-card"
            />
          );
        }
        return (
          <div key={key} className="whitespace-pre-wrap text-[12px] text-ink-2">
            {b.text}
          </div>
        );
      })}
    </div>
  );
}

/** 展开区小节头：标签 + 复制按钮 */
function Section({ label, copyText }: { label: string; copyText: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[11px] text-ink-3">{label}</span>
      <CopyButton text={copyText} />
    </div>
  );
}

export function ToolCallCard({ block, taskId }: ToolCallCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  // 子 Agent 面板：delegate 工具调用绑定的 subagent_* 状态（按 parentToolCallId 关联）。
  // 注意：选择器只取稳定引用（s.subAgents[taskId]），过滤数组在 useMemo 派生，
  // 避免内联选择器每次返回新数组触发 useSyncExternalStore 无限重渲染
  const subagentMap = useSessionStore((s) => s.subAgents[taskId]);
  const subagentStates = useMemo(
    () =>
      subagentMap
        ? Object.values(subagentMap).filter((sub) => sub.parentToolCallId === block.toolCallId)
        : [],
    [subagentMap, block.toolCallId],
  );
  // 运行中自动展开：delegate 调用（含内嵌子 agent 运行）进行时自动展开，流式过程可见；结束后保持展开可折叠
  const anyRunning =
    block.status === "calling" ||
    block.status === "running" ||
    subagentStates.some((s) => s.status === "running");
  useEffect(() => {
    if (anyRunning) setExpanded(true);
  }, [anyRunning]);
  const name = block.toolName || t("tool.defaultName");
  const statusLabel =
    block.status === "calling"
      ? t("tool.status.calling")
      : block.status === "running"
        ? t("tool.status.running")
        : block.status === "success"
          ? t("tool.status.success")
          : t("tool.status.failed");

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="select-none flex items-center gap-1.5 rounded-s border border-line bg-card px-2 py-1 text-[12px] text-ink-2 transition hover:bg-hover"
      >
        <IconWrench size={11} strokeWidth={2} className="text-ink-3" />
        <span className="font-semibold">{name}</span>
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
          {/* 参数（流式拼参时 args 未定、argDelta 累积，展示与复制同一字符串） */}
          {(block.args !== undefined || block.argDelta) && (
            <div>
              <Section
                label={t("tool.args")}
                copyText={block.args !== undefined ? safeStringify(block.args) : block.argDelta}
              />
              <pre className="mt-0.5 overflow-x-auto rounded-s bg-hover px-2 py-1 text-[12px] text-ink-2">
                {block.args !== undefined ? safeStringify(block.args) : block.argDelta}
              </pre>
            </div>
          )}

          {/* 输出（bash 增量，终端样式） */}
          {block.outputDelta && (
            <div>
              <Section label={t("tool.output")} copyText={block.outputDelta} />
              <pre className="mt-0.5 max-h-48 overflow-auto rounded-s bg-terminal px-2 py-1 text-[12px] leading-relaxed text-terminal-text">
                {block.outputDelta}
              </pre>
            </div>
          )}

          {/* 最终结果（结构化/图片渲染，可滚动） */}
          {!block.outputDelta && block.output !== undefined && block.output !== "" && (
            <div>
              <Section
                label={t("tool.result")}
                copyText={serializeToolResultForCopy(block.output, t)}
              />
              <div className="mt-0.5 max-h-64 overflow-y-auto">
                <ToolResultBody output={block.output} />
              </div>
            </div>
          )}

          {/* 错误 */}
          {block.error && (
            <div>
              <Section label={t("tool.error")} copyText={block.error} />
              <div className="mt-0.5 text-[12px] text-danger">{block.error}</div>
            </div>
          )}

          {/* 子 Agent 面板（delegate 工具调用内嵌，类 pi 折叠卡片） */}
          {subagentStates.map((sub) => (
            <SubAgentPanel key={sub.subagentId} subagent={sub} />
          ))}
        </div>
      )}
    </div>
  );
}
