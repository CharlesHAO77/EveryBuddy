/**
 * queue - 排队交付纯函数（无 React 依赖，可单测）。
 *
 * 排队消息（followUp）交付语义：SDK 的 `queue_update` 在入队、交付、clearQueue 时各发一次；
 * `PendingMessageQueue.drain()` 默认 one-at-a-time（FIFO）。本模块只做纯计算：
 *  - diffDeliveredFollowUps：队列变短量 = 本批交付条数
 *  - buildUserBlocks：由文本 + 附件构造用户消息内容块（与 sendMessage 内联构造一致）
 */

import type { AttachmentRef, HistoryBlock } from "@everybuddy/ipc-contract";

/** 队列变短量（交付条数）；不处理变长/相等（返回 0） */
export function diffDeliveredFollowUps(prev: string[], next: string[]): number {
  return Math.max(0, prev.length - next.length);
}

/** 用户消息内容块：附件 file chips 在前，文本块在后（可仅附件无文本） */
export function buildUserBlocks(text: string, attachments: AttachmentRef[]): HistoryBlock[] {
  const blocks: HistoryBlock[] = (attachments ?? []).map((a, i) => ({
    id: String(i),
    kind: "file",
    name: a.name,
    size: a.size,
    done: true,
  }));
  if (text.trim()) {
    blocks.push({ id: String(blocks.length), kind: "text", content: text, done: true });
  }
  return blocks;
}
