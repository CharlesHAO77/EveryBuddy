import { useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";

/* ── Inline SVG Icons ─────────────────────────── */

const CollapseIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
);

const ExpandIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SearchIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ChevronDownIcon = ({ open }: { open?: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="2"
    strokeLinecap="round"
    className={`transition-transform ${open ? "rotate-180" : ""}`}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const NotificationIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

const SettingsIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

/* ── Navigation Icons ─────────────────────────── */

const ExpertIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const AutoIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const FolderIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#999"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

/* ── Data ────────────────────────────────────── */

const navItems = [
  { id: "expert", label: "专家·技能·连接器", icon: ExpertIcon },
  { id: "auto", label: "自动化", icon: AutoIcon },
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

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [workspacesOpen, setWorkspacesOpen] = useState(true);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // 真实数据（替换原 mock）
  const allTasks = useSessionStore((s) => s.tasks);
  const workspaces = useSessionStore((s) => s.workspaces);
  const currentTaskId = useSessionStore((s) => s.currentTaskId);
  const selectTask = useSessionStore((s) => s.selectTask);

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

  return (
    <aside
      className={`flex h-full flex-col border-r border-[#e8e8e8] bg-[#fafafa] transition-all duration-200 ${
        collapsed ? "w-[50px]" : "w-[260px]"
      }`}
    >
      {/* ── Fixed Top Bar: collapse button + new task icon ── */}
      <div className="flex h-[50px] shrink-0 items-center justify-between px-[10px]">
        {/* Collapse button */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-[30px] w-[30px] items-center justify-center rounded-md hover:bg-[#e8e8e8]"
          title={collapsed ? "展开侧栏" : "折叠侧栏"}
        >
          {collapsed ? <ExpandIcon /> : <CollapseIcon />}
        </button>

        {/* Search icon / input (expanded only) */}
        {!collapsed &&
          (showSearch ? (
            <div className="flex flex-1 items-center gap-[6px] pl-[8px]">
              <SearchIcon />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索任务或会话..."
                className="w-full border-0 bg-transparent text-[13px] text-[#333] placeholder:text-[#999] focus:outline-none"
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
              className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#999] transition hover:bg-[#e8e8e8]"
              title="搜索任务"
            >
              <SearchIcon />
            </button>
          ))}
      </div>

      {collapsed ? (
        /* ── Collapsed State: new task icon + bottom settings ── */
        <div className="flex flex-1 flex-col items-center pt-[4px]">
          <button
            type="button"
            onClick={handleNewTask}
            className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#666] hover:bg-[#e8e8e8]"
            title="新建任务"
          >
            <PlusIcon />
          </button>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Settings icon at bottom */}
          <div className="pb-[12px]">
            <button
              type="button"
              onClick={() => useUIStore.getState().setModelSettingsOpen(true)}
              className="flex h-[30px] w-[30px] items-center justify-center rounded-md text-[#999] hover:bg-[#e8e8e8]"
              title="设置"
            >
              <SettingsIcon />
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
              className="flex h-[40px] w-full items-center gap-[10px] rounded-[6px] px-[12px] text-[14px] text-[#333] transition hover:bg-[#f0f0f0] active:scale-[0.98]"
            >
              <PlusIcon />
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
                  className={`flex h-[40px] items-center gap-[10px] rounded-[6px] px-[12px] text-[14px] transition ${
                    isActive
                      ? "bg-[#e8e8e8] font-medium text-[#333]"
                      : "text-[#333] hover:bg-[#f0f0f0]"
                  }`}
                >
                  <Icon />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Divider */}
          <div className="mx-[14px] my-[6px] border-t border-[#e8e8e8]" />

          {/* ── Task List ── */}
          <div className="px-[10px]">
            <button
              type="button"
              onClick={() => setTasksOpen((v) => !v)}
              className="flex h-[30px] w-full items-center justify-between rounded-[4px] px-[10px] text-[13px] text-[#666] hover:bg-[#f0f0f0]"
            >
              <span>任务 ({filteredTasks.length})</span>
              <ChevronDownIcon open={tasksOpen} />
            </button>

            {tasksOpen && (
              <div className="mt-[2px] space-y-[2px]">
                {filteredTasks.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => selectTask(task.id)}
                    className={`flex w-full items-center justify-between rounded-[4px] px-[10px] py-[6px] text-left transition ${
                      task.id === currentTaskId ? "bg-[#e8e8e8]" : "hover:bg-[#f0f0f0]"
                    }`}
                  >
                    <span className="truncate text-[13px] text-[#333]">{task.title}</span>
                    <span className="shrink-0 text-[12px] text-[#999]">{task.time}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Workspace ── */}
          <div className="mt-[4px] flex-1 px-[10px] overflow-y-auto">
            <button
              type="button"
              onClick={() => setWorkspacesOpen((v) => !v)}
              className="flex h-[30px] w-full items-center justify-between rounded-[4px] px-[10px] text-[13px] text-[#666] hover:bg-[#f0f0f0]"
            >
              <span>空间 ({filteredWorkspaces.length})</span>
              <ChevronDownIcon open={workspacesOpen} />
            </button>

            {workspacesOpen && (
              <div className="mt-[2px] space-y-[2px]">
                {filteredWorkspaces.map((ws) => (
                  <div key={ws.id}>
                    <button
                      type="button"
                      onClick={() => setOpenWorkspaceId((id) => (id === ws.id ? null : ws.id))}
                      className="flex h-[30px] w-full items-center gap-[8px] rounded-[4px] px-[10px] text-[13px] text-[#333] transition hover:bg-[#f0f0f0]"
                    >
                      <FolderIcon />
                      <span className="flex-1 text-left">{ws.name}</span>
                      <ChevronDownIcon open={openWorkspaceId === ws.id} />
                    </button>

                    {openWorkspaceId === ws.id &&
                      ws.sessions.map((session) => (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() => selectTask(session.id)}
                          className={`flex w-full items-center justify-between rounded-[4px] px-[10px] py-[6px] pl-[32px] text-left transition ${
                            session.id === currentTaskId ? "bg-[#e8e8e8]" : "hover:bg-[#f0f0f0]"
                          }`}
                        >
                          <span className="truncate text-[13px] text-[#333]">{session.title}</span>
                          <span className="shrink-0 text-[12px] text-[#999]">{session.time}</span>
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Bottom User Area ── */}
          <div className="flex shrink-0 items-center justify-between border-t border-[#e8e8e8] px-[14px] py-[10px]">
            <div className="flex items-center gap-[8px]">
              <div className="h-[28px] w-[28px] rounded-full bg-gradient-to-br from-[#6c8eb2] to-[#4a6a8a] text-[11px] font-medium text-white flex items-center justify-center">
                C
              </div>
              <span className="text-[13px] text-[#333]">Charles.Hao</span>
            </div>
            <div className="flex items-center gap-[6px]">
              <button
                type="button"
                className="flex h-[28px] w-[28px] items-center justify-center rounded-md hover:bg-[#e8e8e8]"
              >
                <NotificationIcon />
              </button>
              <button
                type="button"
                onClick={() => useUIStore.getState().setModelSettingsOpen(true)}
                className="flex h-[28px] w-[28px] items-center justify-center rounded-md hover:bg-[#e8e8e8]"
                title="模型设置"
              >
                <SettingsIcon />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
