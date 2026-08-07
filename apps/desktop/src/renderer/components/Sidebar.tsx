import { useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  IconBell,
  IconChevronDown,
  IconPanelLeftClose,
  IconPanelLeftOpen,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSparkles,
  IconZap,
} from "./icons";
import { TaskListItem } from "./TaskListItem";
import { WorkspaceListItem } from "./WorkspaceListItem";

/* ── Data ────────────────────────────────────── */

const navItems = [
  { id: "expert", label: "专家·技能·连接器", icon: IconSparkles },
  { id: "auto", label: "自动化", icon: IconZap },
];

/** 相对时间格式化 */
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min}分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

/* ── Component ───────────────────────────────── */

/** 确认弹窗状态（删除任务 / 移除空间，单例） */
type ConfirmState =
  | { kind: "task"; id: string; title: string }
  | { kind: "workspace"; id: string; name: string; taskCount: number };

export function Sidebar() {
  // 折叠状态上提至 uiStore，供 MainView（对话区标题左内边距避让）联动订阅
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const setCollapsed = useUIStore((s) => s.setSidebarCollapsed);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [workspacesOpen, setWorkspacesOpen] = useState(true);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // 真实数据（替换原 mock）
  const allTasks = useSessionStore((s) => s.tasks);
  const workspaces = useSessionStore((s) => s.workspaces);
  const currentTaskId = useSessionStore((s) => s.currentTaskId);
  const selectTask = useSessionStore((s) => s.selectTask);
  const deleteTask = useSessionStore((s) => s.deleteTask);
  const removeWorkspace = useSessionStore((s) => s.removeWorkspace);

  // 临时任务（任务区），按 updatedAt 倒序（最新优先）
  const tempTasks = allTasks
    .filter((t) => t.type === "temp")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .map((t) => ({ id: t.id, title: t.title, time: relativeTime(t.updatedAt) }));

  const handleNewTask = () => {
    setActiveNav("");
    selectTask(""); // 回到欢迎页
  };

  const filteredTasks = searchQuery
    ? tempTasks.filter((t) => t.title.includes(searchQuery))
    : tempTasks;

  // 工作空间 + 其下的任务（保持原 ws.sessions 结构），任务按 updatedAt 倒序
  const filteredWorkspaces = workspaces
    .map((ws) => {
      const wsTasks = allTasks
        .filter((t) => t.type === "workspace" && t.workspaceId === ws.id)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
        .map((t) => ({ id: t.id, title: t.title, time: relativeTime(t.updatedAt) }));
      return {
        id: ws.id,
        name: ws.name,
        sessions: searchQuery ? wsTasks.filter((s) => s.title.includes(searchQuery)) : wsTasks,
      };
    })
    .filter((ws) => !searchQuery || ws.sessions.length > 0);

  /** 确认弹窗的确认动作：失败时保持弹窗打开并内联显示错误 */
  const handleConfirm = async () => {
    if (!confirm) return;
    setConfirmLoading(true);
    setConfirmError(null);
    try {
      if (confirm.kind === "task") {
        await deleteTask(confirm.id);
      } else {
        if (openWorkspaceId === confirm.id) setOpenWorkspaceId(null);
        await removeWorkspace(confirm.id);
      }
      setConfirm(null);
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmLoading(false);
    }
  };

  const closeConfirm = () => {
    if (confirmLoading) return;
    setConfirm(null);
    setConfirmError(null);
  };

  // 删除任务的确认文案按类型区分：临时任务的工作目录（work-spaces 下）会一并清除，空间任务保留空间目录
  const confirmTask = confirm?.kind === "task" ? allTasks.find((t) => t.id === confirm.id) : undefined;
  const confirmText =
    confirm?.kind === "task"
      ? {
          title: "删除任务",
          description:
            confirmTask?.type === "temp"
              ? `将删除任务「${confirm.title}」及其全部会话记录。\n磁盘上的会话文件（~/EveryBuddy/sessions 下）与临时工作目录也会被一并清除，此操作不可恢复。`
              : `将删除任务「${confirm.title}」及其全部会话记录。\n磁盘上的会话文件（~/EveryBuddy/sessions 下）也会被一并清除，此操作不可恢复。`,
          confirmLabel: "删除",
        }
      : confirm?.kind === "workspace"
        ? {
            title: "移除空间",
            description: `将移除空间「${confirm.name}」：\n· 空间下 ${confirm.taskCount} 个任务及其会话记录将被一并删除；\n· 空间目录本身保留在磁盘上，不会被删除。\n此操作不可恢复。`,
            confirmLabel: "移除空间",
          }
        : null;

  return (
    <aside
      className={`flex h-full flex-col border-r border-line bg-paper-deep transition-all duration-200 ${
        collapsed ? "w-[50px]" : "w-[260px]"
      }`}
    >
      {/* ── 标题栏拖动层·侧栏部分：与侧栏一体（纸深），mac 下 40px 拖动区，纯拖动无文字 ── */}
      <div className="eb-top-spacer titlebar-drag shrink-0" />

      {/* ── 标题栏下方的侧栏工具栏：折叠按钮常驻左侧固定位置，搜索仅展开态 ── */}
      <div className="flex h-[40px] shrink-0 items-center justify-between px-[10px]">
        {/* Collapse button（展开/折叠两态都固定在顶栏左侧 x=10；红绿灯在标题栏内，不再冲突） */}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
          title={collapsed ? "展开侧栏" : "折叠侧栏"}
        >
          {collapsed ? <IconPanelLeftOpen /> : <IconPanelLeftClose />}
        </button>

        {/* Search icon / input (expanded only) */}
        {!collapsed &&
          (showSearch ? (
            <div className="flex flex-1 items-center gap-[6px] pl-[8px] text-ink-2">
              <IconSearch />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索任务或会话..."
                className="w-full border-0 bg-transparent text-[14px] text-ink placeholder:text-ink-3 focus:outline-none"
                // biome-ignore lint/a11y/noAutofocus: 点击搜索按钮展开后需立即聚焦输入
                autoFocus
                onBlur={() => {
                  if (!searchQuery) {
                    setShowSearch(false);
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowSearch(true)}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
              title="搜索任务"
            >
              <IconSearch />
            </button>
          ))}
      </div>

      {collapsed ? (
        /* ── Collapsed State: 新建任务 + 底部设置 ── */
        <div className="flex flex-1 flex-col items-center gap-[2px] pt-[2px]">
          <button
            type="button"
            onClick={handleNewTask}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover"
            title="新建任务"
          >
            <IconPlus />
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Settings icon at bottom */}
          <div className="pb-[12px]">
            <button
              type="button"
              onClick={() => useUIStore.getState().setModelSettingsOpen(true)}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
              title="设置"
            >
              <IconSettings />
            </button>
          </div>
        </div>
      ) : (
        /* ── Expanded State ── */
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* ── New Task Button ── */}
          <div className="px-[10px]">
            <button
              type="button"
              onClick={handleNewTask}
              className="flex h-[40px] w-full items-center gap-[10px] rounded-s px-[12px] text-[15px] text-ink transition hover:bg-hover active:scale-[0.98]"
            >
              <IconPlus className="text-ink-2" />
              新建任务
            </button>
          </div>

          {/* ── Navigation ── */}
          <nav className="flex flex-col px-[10px]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveNav(item.id)}
                  className={`flex h-[40px] items-center gap-[10px] rounded-s px-[12px] text-[15px] transition ${
                    isActive
                      ? "bg-accent-tint font-semibold text-ink"
                      : "text-ink-2 hover:bg-hover"
                  }`}
                >
                  <Icon className={isActive ? "text-accent" : "text-ink-2"} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Divider */}
          <div className="mx-[14px] my-[6px] border-t border-line" />

          {/* ── Task List ── */}
          <div className="px-[10px]">
            <button
              type="button"
              onClick={() => setTasksOpen((v) => !v)}
              className="flex h-[30px] w-full items-center justify-between rounded-s px-[10px] text-[12px] font-semibold tracking-[0.08em] text-ink-3 transition hover:bg-hover"
            >
              <span>任务 ({filteredTasks.length})</span>
              <IconChevronDown
                size={12}
                strokeWidth={2}
                className={`transition-transform ${tasksOpen ? "rotate-180" : ""}`}
              />
            </button>

            {tasksOpen && (
              <div className="mt-[2px] space-y-[2px]">
                {filteredTasks.map((task) => (
                  <TaskListItem
                    key={task.id}
                    id={task.id}
                    title={task.title}
                    time={task.time}
                    active={task.id === currentTaskId}
                    onSelect={selectTask}
                    onDeleteRequest={(id, title) => setConfirm({ kind: "task", id, title })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* ── Workspace ── */}
          <div className="mt-[4px] flex-1 px-[10px] overflow-y-auto">
            <button
              type="button"
              onClick={() => setWorkspacesOpen((v) => !v)}
              className="flex h-[30px] w-full items-center justify-between rounded-s px-[10px] text-[12px] font-semibold tracking-[0.08em] text-ink-3 transition hover:bg-hover"
            >
              <span>空间 ({filteredWorkspaces.length})</span>
              <IconChevronDown
                size={12}
                strokeWidth={2}
                className={`transition-transform ${workspacesOpen ? "rotate-180" : ""}`}
              />
            </button>

            {workspacesOpen && (
              <div className="mt-[2px] space-y-[2px]">
                {filteredWorkspaces.map((ws) => (
                  <WorkspaceListItem
                    key={ws.id}
                    name={ws.name}
                    open={openWorkspaceId === ws.id}
                    onToggle={() => setOpenWorkspaceId((id) => (id === ws.id ? null : ws.id))}
                    onRemoveRequest={() =>
                      setConfirm({
                        kind: "workspace",
                        id: ws.id,
                        name: ws.name,
                        taskCount: ws.sessions.length,
                      })
                    }
                  >
                    {ws.sessions.map((session) => (
                      <TaskListItem
                        key={session.id}
                        id={session.id}
                        title={session.title}
                        time={session.time}
                        active={session.id === currentTaskId}
                        indent
                        onSelect={selectTask}
                        onDeleteRequest={(id, title) => setConfirm({ kind: "task", id, title })}
                      />
                    ))}
                  </WorkspaceListItem>
                ))}
              </div>
            )}
          </div>

          {/* ── Bottom User Area ── */}
          <div className="flex shrink-0 items-center justify-between border-t border-line px-[14px] py-[10px]">
            <div className="flex items-center gap-[8px]">
              <div className="h-[28px] w-[28px] rounded-full bg-accent text-[12px] font-semibold text-white flex items-center justify-center">
                C
              </div>
              <span className="text-[14px] text-ink-2">Charles.Hao</span>
            </div>
            <div className="flex items-center gap-[6px]">
              <button
                type="button"
                className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
              >
                <IconBell />
              </button>
              <button
                type="button"
                onClick={() => useUIStore.getState().setModelSettingsOpen(true)}
                className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
                title="模型设置"
              >
                <IconSettings />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除任务 / 移除空间确认弹窗（fixed 定位，折叠态也正常） */}
      {confirmText && (
        <ConfirmDialog
          open={!!confirm}
          title={confirmText.title}
          description={confirmText.description}
          confirmLabel={confirmText.confirmLabel}
          loading={confirmLoading}
          error={confirmError}
          onConfirm={handleConfirm}
          onCancel={closeConfirm}
        />
      )}
    </aside>
  );
}
