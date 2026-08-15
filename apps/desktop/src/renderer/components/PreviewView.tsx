/**
 * PreviewView - 右侧「预览」tab 的结果预览。
 *
 * 顶部「最近结果」条（当前任务自动收集的产物 chips），主区按类型渲染选中项：
 * 图片 -> <img>（base64 dataUrl）；Markdown -> MarkdownText；代码/文本 -> <pre>；
 * 二进制/不可预览 -> 提示 + 「在文件夹中显示」「打开所在目录」。
 * 空态引导：点击文件树中的文件，或等待 agent 生成结果。
 */

import type { ReadFileResult } from "@everybuddy/ipc-contract";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../i18n/translateError";
import { type PreviewItem, useSessionStore } from "../stores/sessionStore";
import { Empty } from "./Empty";
import { IconFile } from "./icons";
import { MarkdownText } from "./MarkdownText";

/**
 * 稳定空引用：selector 返回 `?? EMPTY_ITEMS` 而非新建 `[]`。
 * useSyncExternalStore 每次 render 都会调 getSnapshot 并 Object.is 比较——
 * 若每次返回新数组（任务无预览项时），会触发「快照恒变 → 重渲染 → 再变」死循环
 * （Maximum update depth exceeded）。
 */
const EMPTY_ITEMS: PreviewItem[] = [];

/** 无 node:path：按 / 与 \ 最后一个分隔符截取父目录 */
function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

function isMarkdown(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

export function PreviewView() {
  const { t } = useTranslation();
  const taskId = useSessionStore((s) => s.currentTaskId);
  const items = useSessionStore((s) =>
    taskId ? (s.previewItems[taskId] ?? EMPTY_ITEMS) : EMPTY_ITEMS,
  );
  const selection = useSessionStore((s) => (taskId ? (s.previewSelection[taskId] ?? null) : null));
  const setPreviewSelection = useSessionStore((s) => s.setPreviewSelection);
  const selected = items.find((i) => i.id === selection) ?? null;

  const [content, setContent] = useState<ReadFileResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // 选中项变化时拉取文件内容（同路径不重载；cancelled 防竞态）
  useEffect(() => {
    let cancelled = false;
    const absPath = selected?.absPath;
    setContent(null);
    setLoadError(null);
    if (!absPath) return;
    window.electronAPI.workspace
      .readFile(absPath)
      .then((res) => {
        if (cancelled) return;
        if (res.kind === "error") setLoadError(res.error);
        else setContent(res);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // 依赖仅取 absPath：新 chip 加入条不重载当前选中
  }, [selected?.absPath]);

  // 有结果但选中失效（切任务/空选择）时自动选中第一条，避免空白画布
  useEffect(() => {
    if (taskId && items.length > 0 && !selected) {
      const first = items[0];
      if (first) setPreviewSelection(taskId, first.id);
    }
  }, [taskId, items, selected, setPreviewSelection]);

  if (!taskId) return <Empty text={t("preview.emptySelectTask")} />;
  if (items.length === 0) return <Empty text={t("preview.emptyNoResults")} />;

  const revealButtons = (
    <div className="mt-3 flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => void window.electronAPI.workspace.revealPath(selected?.absPath ?? "")}
        className="w-full rounded-s bg-hover px-2 py-1.5 text-[12px] text-ink-2 transition hover:bg-active hover:text-ink"
      >
        {t("preview.revealInFolder")}
      </button>
      <button
        type="button"
        onClick={() =>
          selected && void window.electronAPI.workspace.openDir(parentDir(selected.absPath))
        }
        className="w-full rounded-s bg-hover px-2 py-1.5 text-[12px] text-ink-2 transition hover:bg-active hover:text-ink"
      >
        {t("task.openDir")}
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col gap-2">
      {/* 最近结果条 */}
      <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2">
        <span className="shrink-0">✨</span>
        {t("preview.recentResults")}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setPreviewSelection(taskId, item.id)}
            title={item.absPath}
            className={`flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] transition ${
              item.id === selection
                ? "border-accent bg-accent-tint font-semibold text-accent-strong"
                : "border-line bg-card text-ink-2 hover:bg-hover hover:text-ink"
            }`}
          >
            <IconFile size={11} className="shrink-0" />
            <span className="max-w-[120px] truncate">{item.name}</span>
          </button>
        ))}
      </div>

      {/* 预览画布 */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loadError ? (
          <div className="flex flex-col items-center justify-center px-3 py-6 text-center">
            <p className="text-[12px] text-ink-3">
              {t("preview.unreadable", { name: selected?.name ?? "" })}
            </p>
            <p className="mt-1 break-all text-[11px] text-danger">{translateError(loadError, t)}</p>
            {revealButtons}
          </div>
        ) : content === null ? (
          <div className="py-6 text-center text-[12px] text-ink-3">{t("common.loading")}</div>
        ) : content.kind === "image" ? (
          <img
            src={content.dataUrl}
            alt={selected?.name ?? t("preview.imageAlt")}
            className="max-h-full max-w-full rounded-s border border-line bg-card object-contain"
          />
        ) : content.kind === "text" ? (
          selected && isMarkdown(selected.name) ? (
            <div className="rounded-s border border-line bg-card px-3 py-2">
              <MarkdownText content={content.text} />
            </div>
          ) : (
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-s border border-line bg-card px-2 py-1.5 text-[12px] leading-relaxed text-ink-2">
              {content.text}
            </pre>
          )
        ) : (
          <div className="flex flex-col items-center justify-center px-3 py-6 text-center">
            <p className="text-[12px] text-ink-3">
              {t("preview.unpreviewable", { name: selected?.name ?? "" })}
              {content.kind === "binary" ? t("preview.binaryHint") : ""}
            </p>
            {revealButtons}
          </div>
        )}
      </div>
    </div>
  );
}
