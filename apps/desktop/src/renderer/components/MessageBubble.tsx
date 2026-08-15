/**
 * MessageBubble - 用户消息与错误消息渲染（见 §0.4 / §6.3）。
 * 助手消息（一个 turn 内可能含多轮思考/文本/工具）由 AssistantGroup 合并渲染。
 */
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { translateError } from "../i18n/translateError";
import type { ChatMessage, ContentBlock } from "../stores/sessionStore";
import { formatFileSize } from "./AttachmentPreview";
import { CompactionNoticeCard } from "./CompactionNoticeCard";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconFile,
  IconRedirect,
  IconStop,
} from "./icons";
import { MessageFooter } from "./MessageFooter";
import { RunningIndicator } from "./RunningIndicator";
import { TextCard } from "./TextCard";
import { ThinkingCard } from "./ThinkingCard";
import { ToolCallCard } from "./ToolCallCard";

interface MessageBubbleProps {
  message: ChatMessage;
}

function formatTime(ts: number, locale: string): string {
  return new Date(ts).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

/** 按数量级格式化执行时长：秒 / 分秒 / 时分 */
function formatDuration(ms: number, t: TFunction): string {
  if (ms <= 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return t("time.durSeconds", { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) {
    const sec = s % 60;
    return sec > 0
      ? t("time.durMinutesSeconds", { m, s: sec })
      : t("time.durMinutes", { count: m });
  }
  const h = Math.floor(m / 60);
  const min = m % 60;
  return min > 0 ? t("time.durHoursMinutes", { h, m: min }) : t("time.durHours", { count: h });
}

/** 用户消息 / 错误消息 */
export function MessageBubble({ message }: MessageBubbleProps) {
  const { t } = useTranslation();
  const time = formatTime(message.timestamp, i18n.language);
  if (message.errorMessage) {
    return (
      <div className="flex justify-start">
        <div className="flex items-start gap-1.5 rounded-m border border-danger/30 bg-danger/5 px-4 py-2 text-[14px] text-danger">
          <IconAlertTriangle size={14} className="mt-[3px] shrink-0" />
          <span>{translateError(message.errorMessage, t)}</span>
        </div>
      </div>
    );
  }
  // 用户消息：右侧气泡，附件 chips 在上、文本在下
  const fileBlocks = message.blocks.filter((b) => b.kind === "file");
  const text = message.blocks.find((b) => b.kind === "text")?.content ?? "";
  return (
    <div className="flex w-full flex-col items-end gap-1">
      <div className="max-w-[80%] rounded-xl rounded-br-none bg-accent px-4 py-3 text-sm text-white shadow-card">
        {fileBlocks.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {fileBlocks.map((b) => (
              <span
                key={b.id}
                className="flex max-w-[220px] items-center gap-1 rounded-s bg-white/15 px-1.5 py-0.5 text-[12px]"
                title={b.name}
              >
                <IconFile size={12} className="shrink-0 opacity-80" />
                <span className="truncate">{b.name}</span>
                {b.size !== undefined && (
                  <span className="shrink-0 opacity-70">{formatFileSize(b.size)}</span>
                )}
              </span>
            ))}
          </div>
        )}
        {text && <div className="whitespace-pre-wrap">{text}</div>}
      </div>
      {/* 原生 steer 交付前：琥珀「转向中」指示（当前 turn 边界处交付后由 message_start 清除） */}
      {message.steerPending && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#ecd9a4] bg-[#fdf3d7] px-2 py-[1.5px] text-[11px] font-medium text-[#8a6d1f]">
          <span className="h-1 w-1 animate-pulse rounded-full bg-[#8a6d1f]" />
          {t("chat.steering")}
        </span>
      )}
      <div className="pr-1 text-[11px] text-ink-3">{time}</div>
    </div>
  );
}

interface AssistantGroupProps {
  messages: ChatMessage[];
  /** 所属任务 id（footer 的赞/踩/分支等操作需要） */
  taskId: string;
}

interface FlatBlock {
  block: ContentBlock | { kind: "notice"; content: string };
  key: string;
  streaming: boolean;
}

/**
 * AssistantGroup - 助手消息组渲染。
 * 一个 agent 消息含多个 turn（每个 turn = 一次 LLM 调用 + 工具执行，对应一条 assistant 消息），
 * 合并为一条 AI 消息。结束后将思考+工具过程折叠为「任务已完成 {时长}」，仅展示最终文本结果；
 * 流式过程中保持平铺实时反馈。时间戳在整条消息结束时显示一次。
 */
export function AssistantGroup({ messages, taskId }: AssistantGroupProps) {
  const { t } = useTranslation();
  const isStreaming = messages.some((m) => m.isStreaming);
  const [expanded, setExpanded] = useState(false);
  const first = messages[0];
  const lastMsg = messages[messages.length - 1];
  // 取消语义：任一 turn 被取消即整组按「已取消」呈现（合成 abort 落在最后一条流式消息上）
  const cancelled = messages.some((m) => m.cancelled || m.stopReason === "aborted");
  // 转向语义：原生 steer 发送时在途消息被标记 redirected（渲染层自持）→ 琥珀「已转向」，区别于取消
  const redirected = !cancelled && messages.some((m) => m.redirected);

  // 拍平所有 turn 的 blocks；notice（上下文压缩提示）作为独立块一并纳入，使其可折叠进同一过程
  const blocks: FlatBlock[] = messages.flatMap((m): FlatBlock[] => {
    if (m.role === "notice") {
      return [
        {
          block: { kind: "notice", content: m.noticeContent ?? "" },
          key: m.id,
          streaming: false,
        },
      ];
    }
    return m.blocks.map((block) => ({
      block,
      key: `${m.id}-${block.id}`,
      streaming: m.isStreaming ?? false,
    }));
  });

  // 最后一个 text 块索引 = 最终结果；其前所有块（思考/工具/中间文本/压缩提示）均为「过程」需折叠
  let lastTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i]?.block.kind === "text") {
      lastTextIdx = i;
      break;
    }
  }
  const hasProcess = blocks.some(
    (b) => b.block.kind === "thinking" || b.block.kind === "tool" || b.block.kind === "notice",
  );
  // 过程块 = 除最终结果外的全部块；若无 text 结果则整组为过程
  const processBlocks = lastTextIdx >= 0 ? blocks.filter((_, i) => i !== lastTextIdx) : blocks;
  const resultBlock = lastTextIdx >= 0 ? blocks[lastTextIdx] : undefined;
  // 有可折叠的过程块（思考/工具/压缩提示）才用卡片；三态对仗：已完成(绿) / 已取消(红) / 已转向(琥珀)
  const canCard = !isStreaming && hasProcess && processBlocks.length > 0;
  const cancelCard = canCard && cancelled;
  // 已转向：`redirected` 在**转向交付时**（当前执行完成、steer 真正接管的 turn 边界）才被标记——
  // 卡片于此显示，不等 run 结束、也不在发送瞬间
  const redirectCard = redirected && hasProcess && processBlocks.length > 0;
  // 正常完成：折叠为「任务已完成」卡
  const foldable = canCard && !cancelled && !redirected;
  // 已转向卡 + 新 turn 已开始但尚无内容块（首 token 前）→ 卡片下方补「运行中」指示。
  // 必须 gate 在 redirectCard 上，否则所有流式空块组都会重复渲染 RunningIndicator
  const steerFollowUpStreaming =
    redirectCard &&
    isStreaming &&
    Boolean(lastMsg?.isStreaming) &&
    (lastMsg?.blocks.length ?? 0) === 0;

  // 执行时长：当前会话用 endedAt 精确；历史回放无 endedAt 时退化为末条 timestamp（近似）
  const endTs = lastMsg?.endedAt ?? lastMsg?.timestamp ?? first?.timestamp ?? 0;
  const durationMs = first ? endTs - first.timestamp : 0;
  const durationLabel = formatDuration(durationMs, t);

  const renderBlock = ({ block, key, streaming }: FlatBlock) => {
    if (block.kind === "notice") return <CompactionNoticeCard key={key} summary={block.content} />;
    if (block.kind === "text") return <TextCard key={key} block={block} streaming={streaming} />;
    if (block.kind === "thinking")
      return <ThinkingCard key={key} block={block} streaming={streaming} />;
    if (block.kind === "file") return null; // 附件块只出现在用户消息中
    return <ToolCallCard key={key} block={block} taskId={taskId} />;
  };

  return (
    <div className="flex w-full justify-start">
      <div className="flex max-w-[85%] flex-col gap-1.5">
        {/* 已转向且无过程可折叠（首 block 前转向）：退化为琥珀 pill + 平铺 */}
        {redirected && !redirectCard && !isStreaming && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-[#ecd9a4] bg-[#fdf3d7] px-2.5 py-0.5 text-[12px] font-medium text-[#8a6d1f]">
            <IconRedirect size={10} />
            {t("chat.redirected")}
          </span>
        )}
        {/* 已取消且无过程可折叠（首 token 前取消）：退化为危险色 pill + 平铺 */}
        {cancelled && !cancelCard && !isStreaming && (
          <span className="inline-flex w-fit items-center gap-1 rounded-full border border-danger/30 bg-danger/5 px-2.5 py-0.5 text-[12px] font-medium text-danger">
            <IconStop size={10} />
            {t("chat.cancelled")}
          </span>
        )}
        {cancelCard ? (
          <>
            {/* 「已取消」卡：与「任务已完成」卡对仗（危险圆标 + 时长 + 可展开已执行过程 + 保留文本） */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="group flex w-full items-center gap-[9px] rounded-m border border-danger/30 bg-danger/5 px-3 py-[9px] shadow-card transition hover:bg-danger/10"
            >
              <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-danger text-white shadow-sm">
                <IconStop size={11} strokeWidth={3} />
              </span>
              <span className="text-[12.5px] font-semibold text-danger">{t("chat.cancelled")}</span>
              {durationLabel && (
                <span className="rounded-full bg-hover px-2 py-[2px] text-[11px] font-medium text-ink-2 tabular-nums">
                  {durationLabel}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3 transition group-hover:text-ink-2">
                <span>{expanded ? t("chat.collapse") : t("chat.details")}</span>
                {expanded ? (
                  <IconChevronDown size={12} strokeWidth={2.5} />
                ) : (
                  <IconChevronRight size={12} strokeWidth={2.5} />
                )}
              </span>
            </button>
            {expanded && processBlocks.map(renderBlock)}
            {resultBlock ? renderBlock(resultBlock) : null}
          </>
        ) : redirectCard ? (
          <>
            {/* 「任务已转向」卡：被原生 steer 打断（工具已执行、未产出最终结果），琥珀色与已取消/已完成对仗 */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="group flex w-full items-center gap-[9px] rounded-m border border-[#ecd9a4] bg-[#fdf3d7] px-3 py-[9px] shadow-card transition hover:bg-[#f9edc9]"
            >
              <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-[#8a6d1f] text-white shadow-sm">
                <IconRedirect size={11} strokeWidth={2.5} />
              </span>
              <span className="text-[12.5px] font-semibold text-[#8a6d1f]">
                {t("chat.redirected")}
              </span>
              {durationLabel && (
                <span className="rounded-full bg-hover px-2 py-[2px] text-[11px] font-medium text-ink-2 tabular-nums">
                  {durationLabel}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3 transition group-hover:text-ink-2">
                <span>{expanded ? t("chat.collapse") : t("chat.details")}</span>
                {expanded ? (
                  <IconChevronDown size={12} strokeWidth={2.5} />
                ) : (
                  <IconChevronRight size={12} strokeWidth={2.5} />
                )}
              </span>
            </button>
            {expanded && processBlocks.map(renderBlock)}
            {resultBlock ? renderBlock(resultBlock) : null}
          </>
        ) : foldable ? (
          <>
            {/* 「任务已完成」卡：折叠过程，展示最终文本结果 */}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="group flex w-full items-center gap-[9px] rounded-m border border-line bg-card px-3 py-[9px] shadow-card transition hover:border-accent-line hover:bg-accent-tint/30 hover:shadow-pop"
            >
              <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-full bg-accent text-white shadow-sm">
                <IconCheck size={11} strokeWidth={3.5} />
              </span>
              <span className="text-[12.5px] font-semibold text-ink">{t("chat.completed")}</span>
              {durationLabel && (
                <span className="rounded-full bg-hover px-2 py-[2px] text-[11px] font-medium text-ink-2 tabular-nums">
                  {durationLabel}
                </span>
              )}
              <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3 transition group-hover:text-ink-2">
                <span>{expanded ? t("chat.collapse") : t("chat.details")}</span>
                {expanded ? (
                  <IconChevronDown size={12} strokeWidth={2.5} />
                ) : (
                  <IconChevronRight size={12} strokeWidth={2.5} />
                )}
              </span>
            </button>
            {expanded && processBlocks.map(renderBlock)}
            {resultBlock ? renderBlock(resultBlock) : null}
          </>
        ) : isStreaming && blocks.length === 0 ? (
          // 流式已开始但尚无内容块（首 token 前）：组内「运行中」指示
          <RunningIndicator />
        ) : (
          blocks.map(renderBlock)
        )}
        {/* 已转向卡即时显示后，若新 turn（steer 响应）已开始但尚无内容块 → 卡下方补「运行中」 */}
        {steerFollowUpStreaming && <RunningIndicator />}
        {!isStreaming && (
          <>
            {/* AI 消息 footer：复制/赞/踩/转发/分支 + token计费 + 时间（单行靠左，时间并入 footer） */}
            <MessageFooter taskId={taskId} messages={messages} />
          </>
        )}
      </div>
    </div>
  );
}
