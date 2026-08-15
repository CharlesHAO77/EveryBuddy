/**
 * FileMentionMenu - @ 文件识别下拉面板（面包屑 + 单层条目）。
 * 由 useFileMentions 驱动：目录可进入（面包屑导航）、文件选中插入。
 */

import type { WorkspaceDirEntry } from "@everybuddy/ipc-contract";
import { useTranslation } from "react-i18next";
import { IconChevronRight, IconFile, IconFolder } from "./icons";

interface Props {
  open: boolean;
  loading: boolean;
  entries: WorkspaceDirEntry[];
  /** 当前目录路径（相对 cwd 的目录名数组，[] = 根） */
  path: string[];
  highlightIndex: number;
  onNavigate: (dirName: string) => void;
  onGoRoot: () => void;
  onGoCrumb: (index: number) => void;
  onSelect: (entry: WorkspaceDirEntry) => void;
}

export function FileMentionMenu({
  open,
  loading,
  entries,
  path,
  highlightIndex,
  onNavigate,
  onGoRoot,
  onGoCrumb,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <div className="absolute bottom-full left-0 z-50 mb-[6px] w-[280px] overflow-hidden rounded-m border border-line bg-card shadow-pop">
      {/* 面包屑 */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-2 py-1 text-[12px] text-ink-2">
        <button
          type="button"
          onClick={onGoRoot}
          className={`rounded-s px-1.5 py-0.5 transition hover:bg-hover ${
            path.length === 0 ? "font-bold text-ink" : ""
          }`}
        >
          {t("fileMention.workspace")}
        </button>
        {path.map((p, i) => (
          <span key={path.slice(0, i + 1).join("/")} className="flex items-center gap-0.5">
            <IconChevronRight size={10} className="text-ink-3" />
            <button
              type="button"
              onClick={() => onGoCrumb(i)}
              className={`rounded-s px-1.5 py-0.5 transition hover:bg-hover ${
                i === path.length - 1 ? "font-bold text-ink" : ""
              }`}
            >
              {p}
            </button>
          </span>
        ))}
      </div>

      {/* 目录条目（单层） */}
      <div className="max-h-[220px] overflow-y-auto py-1">
        {loading ? (
          <div className="px-3 py-2 text-[12.5px] text-ink-3">{t("common.loading")}</div>
        ) : entries.length === 0 ? (
          <div className="px-3 py-2 text-[12.5px] text-ink-3">{t("fileMention.emptyDir")}</div>
        ) : (
          entries.map((e, i) => (
            <button
              key={e.path}
              type="button"
              onClick={() => (e.isDir ? onNavigate(e.name) : onSelect(e))}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition ${
                i === highlightIndex
                  ? "bg-accent-tint text-accent-strong"
                  : "text-ink-2 hover:bg-hover"
              }`}
            >
              {e.isDir ? (
                <IconFolder size={14} className="shrink-0 text-[#b98a2f]" />
              ) : (
                <IconFile size={14} className="shrink-0 text-ink-3" />
              )}
              <span className="truncate">{e.name}</span>
              {e.isDir && <IconChevronRight size={11} className="ml-auto shrink-0 text-ink-3" />}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
