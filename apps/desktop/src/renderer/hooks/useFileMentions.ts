/**
 * useFileMentions - @ 工作区文件识别下拉状态机（见 docs/plans/dialog-experience.md 特性⑦）。
 *
 * 输入框出现 `@` 触发：经 workspace.readDir 单层列出当前任务 cwd 的文件/目录，
 * 可进子目录（面包屑导航）；选中文件把 `@相对路径 ` 插入光标处。
 * 键盘处理（方向键/回车/Esc）由本 hook 的 handleKeyDown 返回是否消费，未消费时委派 slash。
 */

import type { WorkspaceDirEntry } from "@everybuddy/ipc-contract";
import { useCallback, useEffect, useState } from "react";

interface UseFileMentionsOptions {
  /** 当前任务工作目录（task.workspacePath ?? task.workDir）；无则禁用 */
  cwd: string | null | undefined;
  text: string;
  setText: (value: string) => void;
  /** 输入框 ref（选中文件时在光标处插入并保持焦点） */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

export function useFileMentions({ cwd, text, setText, textareaRef }: UseFileMentionsOptions) {
  const [open, setOpen] = useState(false);
  /** 当前目录路径（相对 cwd 的目录名数组，[] = 根） */
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<WorkspaceDirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const currentDir = useCallback(() => {
    return path.length > 0 ? `${cwd}/${path.join("/")}` : (cwd ?? "");
  }, [cwd, path]);

  const refresh = useCallback(async () => {
    if (!cwd) return;
    setLoading(true);
    try {
      const dir = currentDir();
      const list = await window.electronAPI.workspace.readDir(dir);
      // 目录在前、文件在后，各自按名称排序
      setEntries(
        [...list].sort((a, b) =>
          a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : a.name.localeCompare(b.name),
        ),
      );
      setHighlightIndex(0);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [cwd, currentDir]);

  const openAt = useCallback(() => {
    if (!cwd) return;
    setPath([]);
    setOpen(true);
  }, [cwd]);

  const close = useCallback(() => setOpen(false), []);

  // 打开/目录变化时加载
  useEffect(() => {
    if (open && cwd) void refresh();
    // 关闭时清空条目，避免残留旧目录
    if (!open) setEntries([]);
  }, [open, cwd, refresh]);

  /** 输入变化：@ 触发开 / 非 @ 结尾关闭 */
  const onTextChange = useCallback(
    (v: string) => {
      if (/@$/.test(v)) {
        openAt();
      } else if (open) {
        close();
      }
    },
    [open, openAt, close],
  );

  const insertMention = useCallback(
    (entry: WorkspaceDirEntry) => {
      const ta = textareaRef.current;
      const rel = path.length > 0 ? `${path.join("/")}/${entry.name}` : entry.name;
      const v = text;
      const caret = ta?.selectionStart ?? v.length;
      const lastAt = v.lastIndexOf("@", caret);
      // 在最后一个 @ 之后插入 `相对路径 `（打开触发时 @ 在末尾，即光标处）
      const insertPos = lastAt >= 0 ? lastAt + 1 : caret;
      const next = `${v.slice(0, insertPos)}${rel} ${v.slice(caret)}`;
      setText(next);
      close();
      requestAnimationFrame(() => {
        ta?.focus();
        if (ta) {
          const pos = insertPos + rel.length + 1;
          ta.setSelectionRange(pos, pos);
        }
      });
    },
    [path, text, setText, close, textareaRef],
  );

  const navigate = useCallback(async (dirName: string) => {
    setPath((p) => [...p, dirName]);
  }, []);

  const goRoot = useCallback(() => setPath([]), []);
  const goCrumb = useCallback((i: number) => setPath((p) => p.slice(0, i + 1)), []);

  /** 键盘处理：菜单开时消费方向键/回车/Esc/Tab；否则返回 false 由调用方委派 */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % Math.max(entries.length, 1));
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + entries.length) % Math.max(entries.length, 1));
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const target = entries[highlightIndex];
        if (target?.isDir) void navigate(target.name);
        else if (target) insertMention(target);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [open, entries, highlightIndex, navigate, insertMention, close],
  );

  return {
    open,
    entries,
    loading,
    path,
    highlightIndex,
    currentDir,
    onTextChange,
    handleKeyDown,
    navigate,
    goRoot,
    goCrumb,
    insertMention,
    close,
  };
}
