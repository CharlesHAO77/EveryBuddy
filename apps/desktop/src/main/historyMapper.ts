/**
 * historyMapper - 会话条目 → 历史消息的纯函数映射（见 §0.4 卡片化消息模型）。
 *
 * 与 agentRuntime 解耦为独立模块，便于在 vitest 中直接单测：
 *  - buildFullPath：从 leaf 沿 parentId 取完整路径（不采用 SDK buildContextEntries 的
 *    压缩感知语义——那是为 LLM 上下文优化，会丢弃 compaction 之前的旧消息）
 *  - entriesToHistory：映射 user/assistant/toolResult，并在压缩边界插入 role=notice 提示
 */

import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { HistoryBlock, HistoryMessage } from "@everybuddy/ipc-contract";
import { splitFileMarkers } from "./fileParser";

/** 满足 SDK SessionManager 的 getBranch/getLeafId 最小形状（真实 SessionManager 天然满足） */
export interface FullPathProvider {
  getBranch(fromId?: string): SessionEntry[];
  getLeafId(): string | null;
}

/** 从叶子沿 parentId 走到根，返回完整路径（含 compaction 等非 message 条目） */
export function buildFullPath(sm: FullPathProvider): SessionEntry[] {
  const leafId = sm.getLeafId();
  return leafId ? sm.getBranch(leafId) : [];
}

export interface EntriesToHistoryOptions {
  /** 是否在压缩边界插入 role=notice 提示消息（默认 false） */
  compactionNotices?: boolean;
}

/** 提取文本内容（content 可能是 string 或内容块数组） */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

/** 读取条目时间戳：message.timestamp 优先，退化到条目 timestamp */
function entryTs(entry: SessionEntry, msgTimestamp?: number): number {
  if (typeof msgTimestamp === "number") return msgTimestamp;
  const parsed = Date.parse(entry.timestamp);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

interface CompactionBoundary {
  /** 边界索引：此索引处的消息是压缩后保留的第一条，提示插在其之前 */
  keptIdx: number;
  summary: string;
  ts: number;
  /** 提示消息 id（用 compaction 条目 id 保证唯一） */
  id: string;
}

/** 预计算所有压缩边界：keptIdx > 0（确实丢弃了早期内容）才产生提示 */
function collectBoundaries(entries: SessionEntry[]): Map<number, CompactionBoundary> {
  const boundaries = new Map<number, CompactionBoundary>();
  for (const entry of entries) {
    if (entry.type !== "compaction") continue;
    const firstKept = entry.firstKeptEntryId;
    if (!firstKept) continue;
    const keptIdx = entries.findIndex((e) => e.id === firstKept);
    if (keptIdx <= 0) continue; // 未找到或边界在路径开头 → 不提示
    // 仅当边界前确有会被压缩掉的实际 message 条目时才提示（控制条目不算）
    const hasDroppedMessages = entries.slice(0, keptIdx).some((e) => e.type === "message");
    if (!hasDroppedMessages) continue;
    if (boundaries.has(keptIdx)) continue; // 多 compaction 指向同一边界时只保留首个
    boundaries.set(keptIdx, {
      keptIdx,
      summary: entry.summary ?? "",
      ts: entryTs(entry),
      id: entry.id,
    });
  }
  return boundaries;
}

/**
 * 将会话条目映射为渲染进程可用的历史消息。
 * 与压缩感知的上下文不同，这里保留完整路径上的全部消息；若开启 compactionNotices，
 * 在每个压缩边界（保留的第一条消息）之前插入一条 role=notice 摘要提示。
 */
export function entriesToHistory(
  entries: SessionEntry[],
  options: EntriesToHistoryOptions = {},
): HistoryMessage[] {
  const boundaries = options.compactionNotices
    ? collectBoundaries(entries)
    : new Map<number, CompactionBoundary>();
  const messages: HistoryMessage[] = [];
  for (const [i, entry] of entries.entries()) {
    // 压缩边界提示：插在保留的第一条消息之前
    const boundary = boundaries.get(i);
    if (boundary) {
      messages.push({
        id: `notice-${boundary.id}`,
        role: "notice",
        timestamp: boundary.ts,
        blocks: [],
        noticeContent: boundary.summary,
      });
    }
    if (entry.type !== "message") continue;
    const msg = entry.message as {
      role?: string;
      content?: unknown;
      timestamp?: number;
      errorMessage?: string;
      toolCallId?: string;
      isError?: boolean;
    };
    const ts = entryTs(entry, msg.timestamp);
    const role = msg.role;

    if (role === "user") {
      // 用户消息内容含附件清单标记（<file name="uploads/x" size="n"/>），
      // 拆分为附件 chips + 剩余文本，历史回放据此渲染
      messages.push({
        id: entry.id,
        role: "user",
        timestamp: ts,
        blocks: splitFileMarkers(extractText(msg.content)),
      });
    } else if (role === "assistant") {
      const blocks: HistoryBlock[] = [];
      // 真实计费元数据：SDK AssistantMessage 已含 usage/cost/provider/model/stopReason（JSONL 持久化），
      // 回放时映射供 footer 展示与「已取消」语义
      const um = (msg as { usage?: unknown }).usage as
        | {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            totalTokens?: number;
            reasoning?: number;
            cost?: { input?: number; output?: number; total?: number };
          }
        | undefined;
      const usage = um
        ? {
            input: um.input ?? 0,
            output: um.output ?? 0,
            cacheRead: um.cacheRead ?? 0,
            cacheWrite: um.cacheWrite ?? 0,
            totalTokens: um.totalTokens ?? 0,
            reasoning: um.reasoning,
            cost: um.cost
              ? {
                  input: um.cost.input ?? 0,
                  output: um.cost.output ?? 0,
                  total: um.cost.total ?? 0,
                }
              : undefined,
          }
        : undefined;
      if (Array.isArray(msg.content)) {
        msg.content.forEach((c, i) => {
          if (!c || typeof c !== "object") return;
          const ct = (c as { type?: string }).type;
          if (ct === "text") {
            blocks.push({
              id: String(i),
              kind: "text",
              content: String((c as { text?: unknown }).text ?? ""),
              done: true,
            });
          } else if (ct === "thinking") {
            blocks.push({
              id: String(i),
              kind: "thinking",
              content: String((c as { thinking?: unknown }).thinking ?? ""),
              done: true,
            });
          } else if (ct === "toolCall") {
            const tc = c as { id?: string; name?: string; arguments?: unknown };
            blocks.push({
              id: String(i),
              kind: "tool",
              toolCallId: tc.id ?? String(i),
              toolName: tc.name ?? "",
              args: tc.arguments,
              argDelta: "",
              status: "success",
              output: undefined,
              outputDelta: "",
              done: true,
            });
          }
        });
      }
      messages.push({
        id: entry.id,
        role: "assistant",
        timestamp: ts,
        blocks,
        errorMessage: msg.errorMessage,
        usage,
        model: (msg as { model?: string }).model,
        provider: (msg as { provider?: string }).provider,
        stopReason: (msg as { stopReason?: string }).stopReason,
      });
    } else if (role === "toolResult") {
      // 工具结果回填到前一条 assistant 消息中匹配 toolCallId 的工具块
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const toolBlock = lastAssistant?.blocks.find(
        (b) => b.kind === "tool" && b.toolCallId === msg.toolCallId,
      );
      if (toolBlock && toolBlock.kind === "tool") {
        toolBlock.output = msg.content;
        toolBlock.status = msg.isError ? "error" : "success";
        if (msg.isError) toolBlock.error = extractText(msg.content);
      }
    }
    // 其余角色（bashExecution/custom/branchSummary/compactionSummary）跳过
  }
  return messages;
}
