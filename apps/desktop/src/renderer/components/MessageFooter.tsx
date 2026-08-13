/**
 * MessageFooter - AI 消息 footer（见 docs/plans/dialog-experience.md 特性⑤）。
 *
 * 单行靠左：复制（末个文本块）/ 赞 / 踩 / 转发（预留置灰）/ 分支（从该消息新建会话）
 * + 会话级 token 计费 chip（点击弹按模型类型 llm/vlm/image 分账明细）+ 时间。
 * 对齐 docs/demos/dialog-experience.html：不展示模型名 / 类型标签 / 本条 usage。
 */

import { useState } from "react";
import { aggregateBilling, formatCost, formatTokens, TYPE_LABELS } from "../billing";
import type { ChatMessage } from "../stores/sessionStore";
import { useSessionStore } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";
import {
  IconCheck,
  IconCopy,
  IconGitBranch,
  IconShare,
  IconThumbsDown,
  IconThumbsUp,
} from "./icons";

interface MessageFooterProps {
  taskId: string;
  /** assistant 组内全部消息（复制取末个文本块；计费用会话级汇总） */
  messages: ChatMessage[];
}

/** 取整组消息中最后一个文本块的内容（复制用） */
function lastTextContent(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (!msg) continue;
    for (let j = msg.blocks.length - 1; j >= 0; j--) {
      const b = msg.blocks[j];
      if (b?.kind === "text") return b.content;
    }
  }
  return "";
}

const TYPE_TAG_CLASS: Record<string, string> = {
  llm: "bg-[#f6efd8] text-[#6b5b1f]",
  vlm: "bg-[#efe8fa] text-[#5a3e8f]",
  image: "bg-[#e2f2f8] text-[#0f6d8f]",
};

export function MessageFooter({ taskId, messages }: MessageFooterProps) {
  const [copied, setCopied] = useState(false);
  const [billOpen, setBillOpen] = useState(false);

  const models = useUIStore((s) => s.models);
  const setMessageFeedback = useSessionStore((s) => s.setMessageFeedback);
  const branchTask = useSessionStore((s) => s.branchTask);
  const pushChatNotice = useSessionStore((s) => s.pushChatNotice);

  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role !== "assistant") return null;

  const feedback = lastMsg.feedback;
  const canBranch = Boolean(lastMsg.entryId);
  const time = new Date(lastMsg.timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // 会话级汇总（计费触发 chip + 弹层明细共用）
  const rows = aggregateBilling(
    useSessionStore.getState().tasks.find((t) => t.id === taskId)?.messages ?? [],
    models,
  );
  const totalTokens = rows.reduce((s, r) => s + r.usage.totalTokens, 0);
  const totalCost = rows.reduce((s, r) => s + r.usage.cost, 0);

  const handleCopy = () => {
    void navigator.clipboard
      .writeText(lastTextContent(messages))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const toggleFeedback = (fb: "up" | "down") => {
    setMessageFeedback(taskId, lastMsg.id, feedback === fb ? null : fb);
  };

  const handleBranch = async () => {
    if (!lastMsg.entryId) return;
    try {
      await branchTask(taskId, lastMsg.entryId);
    } catch (err) {
      pushChatNotice(
        taskId,
        `分支创建失败: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  };

  const iconBtn =
    "flex h-[26px] w-[26px] items-center justify-center rounded-s text-ink-3 transition hover:bg-hover hover:text-ink disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-ink-3";

  return (
    <div className="relative mt-1 flex items-center gap-2 border-t border-dashed border-line pt-1.5">
      {/* 操作图标：复制 / 赞 / 踩 / 转发（置灰「即将推出」）/ 分支 */}
      <div className="flex min-w-0 items-center gap-0.5">
        <button type="button" onClick={handleCopy} title="复制" className={iconBtn}>
          {copied ? <IconCheck size={13} strokeWidth={2.5} /> : <IconCopy size={13} />}
        </button>
        <button
          type="button"
          onClick={() => toggleFeedback("up")}
          title={feedback === "up" ? "取消赞" : "赞"}
          className={`${iconBtn} ${feedback === "up" ? "bg-accent-tint text-accent-strong" : ""}`}
        >
          <IconThumbsUp size={13} />
        </button>
        <button
          type="button"
          onClick={() => toggleFeedback("down")}
          title={feedback === "down" ? "取消踩" : "踩"}
          className={`${iconBtn} ${feedback === "down" ? "bg-accent-tint text-accent-strong" : ""}`}
        >
          <IconThumbsDown size={13} />
        </button>
        <button type="button" disabled title="转发即将推出" className={iconBtn}>
          <IconShare size={13} />
        </button>
        <button
          type="button"
          disabled={!canBranch}
          onClick={handleBranch}
          title={canBranch ? "从该消息新建分支会话" : "无法分支（无会话锚点）"}
          className={iconBtn}
        >
          <IconGitBranch size={13} />
        </button>
      </div>

      {/* 会话级 token 计费 chip（点击弹明细） */}
      {totalTokens > 0 && (
        <button
          type="button"
          onClick={() => setBillOpen((v) => !v)}
          title="查看按模型类型（LLM/VLM/IMG）的计费明细"
          className="shrink-0 rounded-full border border-accent-line bg-accent-tint px-2 py-[1px] font-semibold text-accent-strong transition hover:bg-[#d7ebe4]"
        >
          ◈ {formatTokens(totalTokens)} tok{totalCost > 0 ? ` · ${formatCost(totalCost)}` : ""}
        </button>
      )}

      {/* 时间（并入 footer，单行靠左） */}
      <span className="shrink-0 text-[11px] tabular-nums text-ink-3">{time}</span>

      {/* 计费明细弹层：按模型类型分账 */}
      {billOpen && (
        <>
          <button
            type="button"
            aria-label="关闭计费明细"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setBillOpen(false)}
          />
          <div className="absolute bottom-full right-0 z-50 mb-1 w-[280px] rounded-m border border-line-strong bg-card p-2.5 shadow-pop">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[12px] font-bold text-ink">计费明细 · 按模型类型</span>
              <button
                type="button"
                onClick={() => setBillOpen(false)}
                className="rounded px-1 text-[13px] leading-none text-ink-3 transition hover:bg-hover hover:text-ink"
              >
                ✕
              </button>
            </div>
            {rows.length === 0 ? (
              <div className="py-2 text-center text-[12.5px] text-ink-3">暂无计费数据</div>
            ) : (
              rows.map((r) => (
                <div key={r.type} className="border-t border-line py-1.5 first:border-t-0">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                    <span
                      className={`rounded px-1 text-[9.5px] font-bold leading-[1.5] ${TYPE_TAG_CLASS[r.type] ?? ""}`}
                    >
                      {r.type === "llm" ? "LLM" : r.type === "vlm" ? "VLM" : "IMG"}
                    </span>
                    <span>{TYPE_LABELS[r.type]}</span>
                  </div>
                  {r.model && (
                    <div className="mt-0.5 break-all text-[11px] text-ink-3">{r.model}</div>
                  )}
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5 text-[11.5px] text-ink-2 tabular-nums">
                    <span>in {formatTokens(r.usage.input)}</span>
                    <span>out {formatTokens(r.usage.output)}</span>
                    {r.usage.cacheRead > 0 && <span>cache {formatTokens(r.usage.cacheRead)}</span>}
                    <span>· {formatTokens(r.usage.totalTokens)} tok</span>
                    {r.usage.cost > 0 && (
                      <span className="ml-auto font-bold text-accent-strong">
                        {formatCost(r.usage.cost)}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
