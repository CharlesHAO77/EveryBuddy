/**
 * RightPanel - 右侧面板（待办 + 未来预览区）。
 *
 * 视图注册表便于扩展（后续加制品 md 编辑器、工作区文件等）。待办视图
 * 展示 plan-mode 的三态步骤（完成删除线 / 当前项高亮 / 待执行）与 todo 进度。
 * 视觉对齐 Sidebar（bg-paper-deep + border-l）；折叠图标固定右上角（win 贴原生按钮左侧 / mac 直接贴角），
 * 折叠后仅保留按钮、无长条边栏。
 */

import type { WorkspaceDirEntry } from "@everybuddy/ipc-contract";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";
import {
  IconChevronRight,
  IconClipboardCheck,
  IconEye,
  IconFile,
  IconFolder,
  IconPanelRightClose,
  IconPanelRightOpen,
} from "./icons";

type RightPanelViewId = "todo-plan" | "files" | "preview";

const VIEWS: Array<{ id: RightPanelViewId; label: string; icon: ReactNode }> = [
  { id: "todo-plan", label: "待办", icon: <IconClipboardCheck size={12} /> },
  { id: "files", label: "文件", icon: <IconFile size={12} /> },
  { id: "preview", label: "预览", icon: <IconEye size={12} /> },
];

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center text-[12.5px] text-ink-3">
      {text}
    </div>
  );
}

function ComingSoon() {
  return <Empty text="敬请期待" />;
}

/** 计划步骤三态：已完成（删除线）/ 当前执行项（强调条 + 浅绿底）/ 待执行 */
function TodoPlanView() {
  const taskId = useSessionStore((s) => s.currentTaskId);
  const plan = useSessionStore((s) =>
    taskId ? s.extensionStates[taskId]?.["plan-mode"] : undefined,
  );
  const todo = useSessionStore((s) => (taskId ? s.extensionStates[taskId]?.todo : undefined));

  const planOn = plan?.state === "plan" || plan?.state === "ready" || plan?.state === "executing";
  const showTodo = Boolean(todo?.value || (todo?.lines?.length ?? 0) > 0);
  const todoLines = todo?.lines ?? [];

  if (!taskId) return <Empty text="选择或新建对话查看计划 / 待办" />;

  // 解析步骤三态：首个未完成项视为 current
  const lines = plan?.lines ?? [];
  let seenCurrent = false;
  const doneCount = lines.filter((l) => l.startsWith("☑")).length;
  const steps = lines.map((l) => {
    const done = l.startsWith("☑");
    let state: "done" | "current" | "pending" = done ? "done" : "pending";
    if (!done && !seenCurrent) {
      state = "current";
      seenCurrent = true;
    }
    return { text: l.replace(/^[☑☐]\s*/, ""), state };
  });

  const executing = plan?.state === "executing";
  const planReady = plan?.state === "ready";

  const executePlan = () => {
    if (!taskId) return;
    void window.electronAPI.agent.extensionCommand({
      taskId,
      extension: "plan-mode",
      command: "execute",
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {planOn && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-accent-strong">
            <IconClipboardCheck size={12} className="shrink-0" />
            计划
          </div>
          <div className="flex items-center justify-between rounded-m border border-line bg-card px-3 py-2 shadow-card">
            <span className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-ink">
              <span className="truncate">
                {executing ? "计划执行中" : planReady ? "计划已就绪" : "等待生成计划"}
              </span>
            </span>
            {steps.length > 0 && (
              <span className="shrink-0 rounded-full bg-accent-tint px-2 py-0.5 text-[10.5px] font-semibold text-accent-strong">
                {executing ? `${doneCount}/${steps.length}` : "等待执行"}
              </span>
            )}
          </div>
          {steps.length === 0 && !executing && (
            <p className="px-1 text-[11.5px] leading-snug text-ink-3">
              发送消息，模型会在回复中给出「Plan:」编号计划
            </p>
          )}
          <div className="flex flex-col gap-0.5">
            {steps.map((s) => (
              <div
                key={s.text}
                className={`flex items-start gap-2 rounded-s border-l-2 px-2 py-1 text-[12px] leading-snug ${
                  s.state === "current"
                    ? "border-accent bg-accent-tint font-semibold text-ink"
                    : "border-transparent"
                }`}
              >
                <span
                  className={`shrink-0 text-[11px] leading-[1.6] ${
                    s.state === "done"
                      ? "text-accent"
                      : s.state === "current"
                        ? "text-accent"
                        : "text-ink-3"
                  }`}
                >
                  {s.state === "done" ? "☑" : s.state === "current" ? "▸" : "☐"}
                </span>
                <span
                  className={
                    s.state === "done"
                      ? "text-ink-3 line-through"
                      : s.state === "pending"
                        ? "text-ink-2"
                        : "text-ink"
                  }
                >
                  {s.text}
                </span>
              </div>
            ))}
          </div>
          {plan?.state === "ready" && (
            <button
              type="button"
              onClick={executePlan}
              className="w-full rounded-s bg-accent py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-accent-strong active:scale-[0.98]"
            >
              执行计划
            </button>
          )}
        </section>
      )}

      {showTodo && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-ink-2">
              <span>📝</span>
              待办
            </span>
            {todo?.value && (
              <span className="shrink-0 rounded-full border border-line bg-card px-2 py-0.5 text-[10.5px] font-semibold text-ink-2">
                {todo.value.replace(/^📝\s*/, "")}
              </span>
            )}
          </div>
          {todoLines.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {todoLines.map((l) => {
                const done = l.startsWith("☑");
                return (
                  <div
                    key={l}
                    className="flex items-start gap-2 rounded-s border-l-2 border-transparent px-2 py-1 text-[12px] leading-snug"
                  >
                    <span
                      className={`shrink-0 text-[11px] leading-[1.6] ${
                        done ? "text-accent" : "text-ink-3"
                      }`}
                    >
                      {done ? "☑" : "☐"}
                    </span>
                    <span className={done ? "text-ink-3 line-through" : "text-ink-2"}>
                      {l.replace(/^[☑☐]\s*/, "")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {!planOn && !showTodo && <Empty text="开启计划模式后这里显示计划步骤" />}
    </div>
  );
}

/** 加载并渲染某目录的直接子项：文件夹展开 / 文件只读行；处理加载中、失败与空目录态 */
function DirContents({ path: dirPath, depth }: { path: string; depth: number }) {
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
      <div className="px-1.5 py-0.5 text-[11.5px] text-ink-3" style={{ paddingLeft: depth * 14 + 6 }}>
        加载中…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-1.5 py-0.5 text-[11.5px] text-ink-3" style={{ paddingLeft: depth * 14 + 6 }}>
        读取失败：{error}
      </div>
    );
  }
  if (entries === null) return null;
  if (entries.length === 0) {
    return (
      <div className="px-1.5 py-0.5 text-[11.5px] text-ink-3" style={{ paddingLeft: depth * 14 + 6 }}>
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
          <DirNode key={e.path} name={e.name} path={e.path} depth={depth} />
        ) : (
          <div
            key={e.path}
            className="flex items-center gap-1.5 rounded-s px-1.5 py-1 text-[12px] text-ink-2"
            style={{ paddingLeft: rowPad }}
          >
            <span className="w-3 shrink-0" />
            <IconFile size={13} className="shrink-0 text-ink-3" />
            <span className="min-w-0 truncate">{e.name}</span>
          </div>
        ),
      )}
    </div>
  );
}

/** 文件夹行：点击展开/收起（子项由 DirContents 懒加载） */
function DirNode({ name, path: dirPath, depth }: { name: string; path: string; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title={dirPath}
        className="flex w-full items-center gap-1.5 rounded-s px-1.5 py-1 text-[12px] text-ink-2 transition hover:bg-hover hover:text-ink"
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        <IconChevronRight
          size={12}
          className={`shrink-0 text-ink-3 transition-transform ${open ? "rotate-90" : ""}`}
        />
        <IconFolder size={14} className="shrink-0 text-accent" />
        <span className="min-w-0 truncate">{name}</span>
      </button>
      {open && <DirContents path={dirPath} depth={depth + 1} />}
    </div>
  );
}

/** 「文件」视图：当前任务工作空间目录（空间任务 -> workspacePath；临时任务 -> workDir），直接显示目录内容 */
function FileTreeView() {
  const taskId = useSessionStore((s) => s.currentTaskId);
  const task = useSessionStore((s) => (taskId ? s.tasks.find((t) => t.id === taskId) : undefined));
  const rootPath = task?.workspacePath ?? task?.workDir;

  if (!rootPath) {
    return <Empty text="选择或新建对话查看工作空间文件" />;
  }
  return <DirContents key={rootPath} path={rootPath} depth={0} />;
}

export function RightPanel() {
  const open = useUIStore((s) => s.rightPanelOpen);
  const setOpen = useUIStore((s) => s.setRightPanelOpen);
  const [view, setView] = useState<RightPanelViewId>("todo-plan");
  // 仅 Windows 右上角有原生窗口按钮（WCO，含缩放/最大化），折叠按钮需贴其左侧；macOS 无右上角按钮，直接贴角
  const isWin = document.documentElement.dataset.platform === "win";

  // 原生窗口按钮区宽度（Windows WCO）：geometrychange 时随窗口几何/DPI 更新
  const [wcoRight, setWcoRight] = useState(() => getWcoRight(isWin));
  useEffect(() => {
    const wco = (navigator as Navigator & {
      windowControlsOverlay?: {
        getTitlebarAreaRect?: () => { width: number };
        addEventListener?: (e: string, f: () => void) => void;
        removeEventListener?: (e: string, f: () => void) => void;
      };
    }).windowControlsOverlay;
    const update = () => setWcoRight(getWcoRight(isWin));
    wco?.addEventListener?.("geometrychange", update);
    return () => wco?.removeEventListener?.("geometrychange", update);
  }, [isWin]);

  if (!open) {
    /* 折叠态：面板主体消失，仅右上角浮层展开按钮（win 贴原生按钮左侧 / mac 直接贴角） */
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="打开右侧面板"
        className="titlebar-no-drag fixed z-10 flex h-[30px] w-[30px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
        style={{ top: 5, right: wcoRight }}
      >
        <IconPanelRightOpen />
      </button>
    );
  }

  return (
    <div className="flex h-full w-[250px] shrink-0 flex-col border-l border-line bg-paper-deep">
      {/* 标题栏拖动层：折叠按钮固定在面板左上角（样式对齐 Sidebar）；win/mac 40px，其余平台 0 */}
      <div className="eb-top-spacer titlebar-drag flex shrink-0 items-center px-[10px]">
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="收起"
          className="titlebar-no-drag flex h-[30px] w-[30px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
        >
          <IconPanelRightClose />
        </button>
      </div>
      <div className="flex items-center gap-1 px-3 pb-1 pt-2.5">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setView(v.id)}
            title={v.label}
            className={`flex flex-1 items-center justify-center gap-1 rounded-s px-1 py-1.5 text-[11.5px] transition ${
              view === v.id
                ? "bg-card font-semibold text-ink shadow-card"
                : "text-ink-2 hover:text-ink"
            }`}
          >
            {v.icon}
            {v.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-1">
        {view === "todo-plan" ? (
          <TodoPlanView />
        ) : view === "files" ? (
          <FileTreeView />
        ) : (
          <ComingSoon />
        )}
      </div>
    </div>
  );
}

/** 折叠按钮右侧偏移：win=原生按钮区宽度+4（贴其左侧）；mac/其他=8（直接贴右上角，无缩放图标）。 */
function getWcoRight(isWin: boolean): number {
  if (!isWin) return 8;
  const wco = (navigator as Navigator & {
    windowControlsOverlay?: { getTitlebarAreaRect?: () => { width: number } };
  }).windowControlsOverlay;
  // Win11 默认 3×46px=138；只采信 >0 且 ≤138 的合理区间，异常/超宽（如 DPI 缩放导致）一律回退 138，
  // 避免折叠按钮被推离原生按钮太远
  const measured = wco?.getTitlebarAreaRect?.().width ?? 138;
  const w = measured > 0 && measured <= 138 ? measured : 138;
  return w + 4;
}
