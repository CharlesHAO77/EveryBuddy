import { useState } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { UserMenu } from "./UserMenu";

const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const ChevronDownIcon = ({ open }: { open?: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    className={`transition-transform ${open ? "rotate-180" : ""}`}
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const TaskIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9 11l3 3L22 4" />
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
  </svg>
);

const WorkspaceIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
  </svg>
);

const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
  </svg>
);

interface TaskItem {
  id: string;
  title: string;
  time: string;
}

interface Workspace {
  id: string;
  name: string;
  sessions: { id: string; title: string }[];
}

const mockTasks: TaskItem[] = [
  { id: "t1", title: "设计 iPhone 20 ProMAX 原型", time: "23小时前" },
  { id: "t2", title: "总结 AI 服务器配置表文档", time: "29天前" },
];

const mockWorkspaces: Workspace[] = [
  {
    id: "w1",
    name: "test",
    sessions: [
      { id: "s1", title: "会话 1" },
      { id: "s2", title: "会话 2" },
    ],
  },
  {
    id: "w2",
    name: "项目新手指引",
    sessions: [{ id: "s3", title: "欢迎引导" }],
  },
];

export function Sidebar() {
  const [tasksOpen, setTasksOpen] = useState(true);
  const [workspacesOpen, setWorkspacesOpen] = useState(true);
  const [openWorkspaceId, setOpenWorkspaceId] = useState<string | null>("w1");

  const { currentSessionId, createSession, selectSession, clearCurrentSession } = useSessionStore();

  const handleNewTask = () => {
    createSession("新任务");
  };

  const handleBackToWelcome = () => {
    clearCurrentSession();
  };

  return (
    <aside className="flex h-full w-[var(--sidebar-width)] flex-col border-r border-[var(--border)] bg-[var(--bg-sidebar)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={handleBackToWelcome}
          className="flex items-center gap-2 rounded-lg outline-none transition hover:bg-[var(--primary-bg)]"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-bold text-white">
            e
          </div>
          <div className="flex flex-col text-left">
            <span className="text-sm font-semibold leading-tight">everyBuddy</span>
            <span className="text-[10px] text-[var(--text-muted)]">v0.1.0</span>
          </div>
        </button>
      </div>

      {/* New Task Button */}
      <div className="px-3 pb-2">
        <button
          type="button"
          onClick={handleNewTask}
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-dark)] px-3 py-2 text-sm font-semibold text-gray-900 shadow-[var(--shadow-accent-glow)] transition hover:brightness-105 active:scale-[0.97]"
        >
          <PlusIcon />
          新建任务
        </button>
      </div>

      {/* Tasks */}
      <div className="px-2">
        <button
          type="button"
          onClick={() => setTasksOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--primary-bg)] hover:text-[var(--primary-dark)]"
        >
          <span>任务 ({mockTasks.length})</span>
          <ChevronDownIcon open={tasksOpen} />
        </button>

        {tasksOpen && (
          <div className="mt-1 space-y-1 px-1">
            {mockTasks.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => selectSession(task.id)}
                className={`flex w-full items-start gap-2 rounded-lg border-l-4 bg-[var(--surface-card)] px-3 py-2 text-left text-sm shadow-sm transition ${
                  currentSessionId === task.id
                    ? "border-[var(--accent)] text-[var(--primary-dark)] shadow-[var(--shadow-card)]"
                    : "border-[var(--primary-light)] text-[var(--text-main)] hover:shadow-[var(--shadow-card)]"
                }`}
              >
                <span className="mt-0.5 text-[var(--primary)]">
                  <TaskIcon />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{task.title}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">{task.time}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Workspaces */}
      <div className="mt-2 flex-1 overflow-y-auto px-2">
        <button
          type="button"
          onClick={() => setWorkspacesOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--primary-bg)] hover:text-[var(--primary-dark)]"
        >
          <span>空间 ({mockWorkspaces.length})</span>
          <ChevronDownIcon open={workspacesOpen} />
        </button>

        {workspacesOpen && (
          <div className="mt-1 space-y-1">
            {mockWorkspaces.map((ws) => (
              <div key={ws.id}>
                <button
                  type="button"
                  onClick={() => setOpenWorkspaceId((id) => (id === ws.id ? null : ws.id))}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm font-medium text-[var(--text-main)] hover:bg-[var(--primary-bg)]"
                >
                  <WorkspaceIcon />
                  <span className="flex-1 truncate">{ws.name}</span>
                  <ChevronDownIcon open={openWorkspaceId === ws.id} />
                </button>

                {openWorkspaceId === ws.id && (
                  <div className="ml-5 space-y-0.5 border-l border-[var(--primary-light)] pl-2">
                    {ws.sessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => selectSession(session.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition ${
                          currentSessionId === session.id
                            ? "bg-[var(--primary-bg)] text-[var(--primary-dark)]"
                            : "text-[var(--text-muted)] hover:bg-[var(--primary-bg)] hover:text-[var(--text-main)]"
                        }`}
                      >
                        <ChatIcon />
                        <span className="truncate">{session.title}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* User Menu - bottom left */}
      <div className="border-t border-[var(--border)] p-3">
        <UserMenu
          trigger={
            <div className="flex items-center gap-2 rounded-lg px-2 py-2 transition hover:bg-[var(--primary-bg)]">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--primary)] to-[var(--primary-dark)] text-sm font-semibold text-white">
                CH
              </div>
              <div className="flex flex-col text-left">
                <span className="text-sm font-medium text-[var(--text-main)]">Charles.Hao</span>
                <span className="text-[10px] text-[var(--text-muted)]">点击打开菜单</span>
              </div>
            </div>
          }
        />
      </div>
    </aside>
  );
}
