/**
 * FileTreeView - 右侧「文件」tab 的工作空间目录树（懒加载单层）。
 *
 * 从 RightPanel 抽出：目录行点击展开/收起，⋯ 菜单「打开目录」；
 * 文件行点击打开预览（切到预览 tab），⋯ 菜单「打开所在目录」（Explorer 选中该文件）。
 * 图片判定与主进程 readFileForPreview 的 PREVIEW_IMAGE_EXT 保持一致。
 */

import type { WorkspaceDirEntry } from "@everybuddy/ipc-contract";
import { useCallback, useEffect, useState } from "react";
import { type PreviewItem, useSessionStore } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";
import { ActionMenu } from "./ActionMenu";
import { Empty } from "./Empty";
import { IconChevronRight, IconFile, IconFolder } from "./icons";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"]);

function isImageName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXTS.has(name.slice(dot + 1).toLowerCase());
}

/** 点击文件行：加入「最近结果」并切到预览 tab 查看 */
function openFileInPreview(taskId: string, entry: WorkspaceDirEntry): void {
  const s = useSessionStore.getState();
  // 已在最近结果中的文件：复用其 id，避免选中一个不在列表里的 id（预览空白）
  const existing = s.previewItems[taskId]?.find((i) => i.absPath === entry.path);
  if (existing) {
    s.setPreviewSelection(taskId, existing.id);
  } else {
    const item: PreviewItem = {
      id: crypto.randomUUID(),
      kind: isImageName(entry.name) ? "image" : "file",
      name: entry.name,
      absPath: entry.path,
    };
    s.addPreviewItems(taskId, [item]);
    s.setPreviewSelection(taskId, item.id);
  }
  const ui = useUIStore.getState();
  ui.setRightPanelOpen(true);
  ui.setRightPanelView("preview");
}

/** 加载并渲染某目录的直接子项：文件夹展开 / 文件点击预览；处理加载中、失败与空目录态 */
function DirContents({
  taskId,
  path: dirPath,
  depth,
}: {
  taskId: string;
  path: string;
  depth: number;
}) {
  const [entries, setEntries] = useState<WorkspaceDirEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await window.electronAPI.workspace.readDir(dirPath));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [dirPath]);

  // 挂载即加载（失败后不自动重试；重新展开/切换任务可重试）
  useEffect(() => {
    if (entries === null && error === null && !loading) void load();
  }, [entries, error, loading, load]);

  if (loading) {
    return (
      <div
        className="px-1.5 py-0.5 text-[11.5px] text-ink-3"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        加载中…
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="px-1.5 py-0.5 text-[11.5px] text-ink-3"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        读取失败：{error}
      </div>
    );
  }
  if (entries === null) return null;
  if (entries.length === 0) {
    return (
      <div
        className="px-1.5 py-0.5 text-[11.5px] text-ink-3"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {depth === 0 ? "文件为空" : "空目录"}
      </div>
    );
  }

  const sorted = entries
    .slice()
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  const rowPad = depth * 14 + 6;

  return (
    <div>
      {sorted.map((e) =>
        e.isDir ? (
          <DirNode key={e.path} taskId={taskId} name={e.name} path={e.path} depth={depth} />
        ) : (
          <FileNode key={e.path} taskId={taskId} entry={e} rowPad={rowPad} />
        ),
      )}
    </div>
  );
}

/** 文件行：点击打开预览；⋯ 菜单「打开所在目录」（Explorer 选中该文件） */
function FileNode({
  taskId,
  entry,
  rowPad,
}: {
  taskId: string;
  entry: WorkspaceDirEntry;
  rowPad: number;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 行内含 ⋯ 按钮，无法用 button
    <div
      role="button"
      tabIndex={0}
      onClick={() => openFileInPreview(taskId, entry)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") openFileInPreview(taskId, entry);
      }}
      title={entry.path}
      className="group flex items-center gap-1.5 rounded-s px-1.5 py-1 text-[12px] text-ink-2 transition hover:bg-hover hover:text-ink"
      style={{ paddingLeft: rowPad }}
    >
      <span className="w-3 shrink-0" />
      <IconFile size={13} className="shrink-0 text-ink-3" />
      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      <ActionMenu
        items={[
          {
            label: "打开所在目录",
            onSelect: () => void window.electronAPI.workspace.revealPath(entry.path),
          },
        ]}
      />
    </div>
  );
}

/** 文件夹行：点击展开/收起（子项由 DirContents 懒加载）；⋯ 菜单「打开目录」 */
function DirNode({
  taskId,
  name,
  path: dirPath,
  depth,
}: {
  taskId: string;
  name: string;
  path: string;
  depth: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      {/* biome-ignore lint/a11y/useSemanticElements: 行内含 ⋯ 按钮，无法用 button */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen(!open);
        }}
        title={dirPath}
        className="group flex w-full items-center gap-1.5 rounded-s px-1.5 py-1 text-[12px] text-ink-2 transition hover:bg-hover hover:text-ink"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <IconChevronRight
          size={12}
          className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <IconFolder size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <ActionMenu
          items={[
            {
              label: "打开目录",
              onSelect: () => void window.electronAPI.workspace.openDir(dirPath),
            },
          ]}
        />
      </div>
      {open && <DirContents taskId={taskId} path={dirPath} depth={depth + 1} />}
    </div>
  );
}

/** 文件树入口：当前任务工作空间目录（空间任务 -> workspacePath；临时任务 -> workDir） */
export function FileTreeView() {
  const taskId = useSessionStore((s) => s.currentTaskId);
  const task = useSessionStore((s) => (taskId ? s.tasks.find((t) => t.id === taskId) : undefined));
  const rootPath = task?.workspacePath ?? task?.workDir;

  if (!taskId || !rootPath) {
    return <Empty text="选择或新建对话查看工作空间文件" />;
  }
  return <DirContents key={rootPath} taskId={taskId} path={rootPath} depth={0} />;
}
