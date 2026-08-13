import type { AttachmentRef } from "@everybuddy/ipc-contract";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { MENTION_TOKEN_RE, type MentionFile, parseFileMentions } from "../fileMentions";
import { useAttachments } from "../hooks/useAttachments";
import { useFileMentions } from "../hooks/useFileMentions";
import { useSlashCommands } from "../hooks/useSlashCommands";
import { isBareSteerCommand, parseCommandChannel } from "../slashCommands";
import { type ChatMessage, useSessionStore } from "../stores/sessionStore";
import { type CategoryId, getChatDefaultId, useUIStore } from "../stores/uiStore";
import { AttachmentPreview } from "./AttachmentPreview";
import { CompactionNoticeCard } from "./CompactionNoticeCard";
import { ConversationTitle } from "./ConversationTitle";
import { FileMentionMenu } from "./FileMentionMenu";
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconFolder,
  IconMic,
  IconPlus,
  IconStop,
  IconX,
} from "./icons";
import { AssistantGroup, MessageBubble } from "./MessageBubble";
import { ModelSelector } from "./ModelSelector";
import { ModeSelect } from "./ModeSelect";
import { PendingQueueBar } from "./PendingQueueBar";
import { RunningIndicator } from "./RunningIndicator";
import { SendModeChooser } from "./SendModeChooser";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { ToolApprovalBar } from "./ToolApprovalBar";

/* ── Model Selector Helpers ───────────────────── */

function useDefaultProviderId() {
  return useUIStore((s) => getChatDefaultId(s.models));
}

type MessageGroup =
  | { kind: "user" | "error"; messages: ChatMessage[] }
  | { kind: "assistant"; messages: ChatMessage[] }
  | { kind: "notice"; messages: ChatMessage[] };

/** 将连续的 assistant 消息合并为一组（一个 agent 消息含多个 turn），user/错误独立成组。
 *  例外：压缩提示（notice）若位于 assistant 组中段（同一 agent 过程被压缩后继续），并入该组一同折叠，
 *  避免一个 agent 过程被拆成多个折叠框。 */
function groupMessages(messages: ChatMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  for (const msg of messages) {
    if (msg.role === "notice") {
      const last = groups[groups.length - 1];
      if (last?.kind === "assistant") {
        last.messages.push(msg);
      } else {
        groups.push({ kind: "notice", messages: [msg] });
      }
    } else if (msg.role === "user") {
      groups.push({ kind: "user", messages: [msg] });
    } else if (msg.errorMessage) {
      groups.push({ kind: "error", messages: [msg] });
    } else {
      const last = groups[groups.length - 1];
      if (last?.kind === "assistant") {
        last.messages.push(msg);
      } else {
        groups.push({ kind: "assistant", messages: [msg] });
      }
    }
  }
  return groups;
}

/* ── Data ────────────────────────────────────── */

const modes = [
  { id: "daily" as CategoryId, label: "日常办公" },
  { id: "coding" as CategoryId, label: "代码开发" },
];

const dailyTags = [{ id: "ppt", label: "PPT生成" }];

const codingTags = [
  { id: "daily-dev", label: "日常开发" },
  { id: "website", label: "网站开发" },
  { id: "agent", label: "Agent应用" },
  { id: "skill", label: "Skill开发" },
  { id: "cicd", label: "CI/CD" },
  { id: "docs", label: "文档" },
];

/**
 * 将 `@token` 解析为真实文件：token 为相对路径（src/auth/login.ts），
 * 用 workspace.readDir 读其父目录单层，命中非目录文件即为有效（构造 AttachmentRef）。
 */
async function resolveMentionFile(cwd: string, token: string): Promise<MentionFile | null> {
  if (!token || token.startsWith("/") || token.includes("..")) return null;
  const parts = token.split("/");
  const name = parts.pop();
  if (!name) return null;
  const parentRel = parts.join("/");
  const dir = parentRel ? `${cwd}/${parentRel}` : cwd;
  try {
    const entries = await window.electronAPI.workspace.readDir(dir);
    const hit = entries.find((e) => e.name === name);
    if (hit && !hit.isDir) return { path: hit.path, name: hit.name, size: hit.size };
  } catch {
    // 目录不存在/不可读 → 视为未命中（保留字面）
  }
  return null;
}

/** 解析文本中的 @ 引用：命中 → 剥离为附件，未命中保留字面 */
async function resolveMentions(
  text: string,
  cwd: string | null | undefined,
): Promise<{ clean: string; attachments: AttachmentRef[] }> {
  if (!cwd) return { clean: text, attachments: [] };
  const tokens = [...text.matchAll(MENTION_TOKEN_RE)]
    .map((m) => m[1])
    .filter((t): t is string => Boolean(t));
  const files: MentionFile[] = [];
  for (const token of tokens) {
    const f = await resolveMentionFile(cwd, token);
    if (f) files.push(f);
  }
  return parseFileMentions(text, files);
}

/* ── MainView Component ──────────────────────── */

export function MainView() {
  const currentTaskId = useSessionStore((s) => s.currentTaskId);
  const currentTaskTitle = useSessionStore(
    (s) => s.tasks.find((t) => t.id === s.currentTaskId)?.title ?? null,
  );
  // 侧栏折叠状态：折叠时标题左内边距让位红绿灯（50+30=80 > 红绿灯右缘 73）
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);

  return (
    <main className="flex flex-1 flex-col overflow-hidden bg-paper">
      {/* ── 标题栏拖动层·对话区部分：与对话区一体（纸色），mac 下 40px 拖动区；对话标题可点击重命名靠左 ── */}
      <div
        className={`eb-top-spacer titlebar-drag flex shrink-0 items-center transition-[padding-left] duration-200 ${
          sidebarCollapsed ? "pl-[30px]" : "pl-[12px]"
        }`}
      >
        {currentTaskId && currentTaskTitle && (
          <ConversationTitle taskId={currentTaskId} title={currentTaskTitle} />
        )}
      </div>
      {/* 拖动层占位后的剩余高度交给 ChatView/WelcomeView（二者 root 用 h-full / min-h-full，需容器定高） */}
      <div className="flex min-h-0 flex-1 flex-col">
        {currentTaskId ? <ChatView taskId={currentTaskId} /> : <WelcomeView />}
      </div>
    </main>
  );
}

/* ── Workspace Selector ─────────────────────── */

/**
 * WorkspaceSelector - 主页「选择工作空间」下拉菜单。
 * 选项：已有空间 / 指定文件夹（注册为空间）/ 新建空间（输入名称）/ 无工作空间（临时任务）。
 * 选定后写入 sessionStore.pendingWorkspaceId，发送首条消息时据此创建空间任务。
 */
function WorkspaceSelector() {
  const workspaces = useSessionStore((s) => s.workspaces);
  const pendingWorkspaceId = useSessionStore((s) => s.pendingWorkspaceId);
  const setPendingWorkspace = useSessionStore((s) => s.setPendingWorkspace);
  const addWorkspace = useSessionStore((s) => s.addWorkspace);

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = workspaces.find((w) => w.id === pendingWorkspaceId) ?? null;
  const label = selected ? selected.name : "选择工作空间";

  const handlePickFolder = async () => {
    const dir = await window.electronAPI.workspace.selectDir();
    if (!dir) return;
    const folderName = dir.split("/").pop() || dir;
    const ws = await window.electronAPI.workspace.create(folderName, dir);
    addWorkspace(ws);
    setPendingWorkspace(ws.id);
    setOpen(false);
  };

  const handleCreateNamed = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const ws = await window.electronAPI.workspace.createNamed(trimmed);
    addWorkspace(ws);
    setPendingWorkspace(ws.id);
    setName("");
    setCreating(false);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-[4px] text-[13px] text-ink-3 transition hover:text-ink-2"
      >
        {label}
        <IconChevronDown size={10} strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-[6px] w-[220px] rounded-m border border-line bg-card py-[6px] shadow-pop">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              type="button"
              onClick={() => {
                setPendingWorkspace(ws.id);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[14px] transition hover:bg-hover ${
                ws.id === pendingWorkspaceId ? "text-ink" : "text-ink-2"
              }`}
            >
              <IconFolder className="text-ink-2" />
              <span className="flex-1 truncate">{ws.name}</span>
              {ws.id === pendingWorkspaceId && (
                <IconCheck size={12} strokeWidth={2.5} className="text-accent" />
              )}
            </button>
          ))}

          <div className="my-[4px] border-t border-line" />

          <button
            type="button"
            onClick={handlePickFolder}
            className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[14px] text-ink-2 transition hover:bg-hover"
          >
            <IconFolder className="text-ink-2" />
            指定文件夹
          </button>

          {creating ? (
            <div className="px-[10px] py-[6px]">
              <input
                type="text"
                value={name}
                // biome-ignore lint/a11y/noAutofocus: 点「新建空间」后需立即聚焦名称输入
                autoFocus
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreateNamed();
                  }
                  if (e.key === "Escape") {
                    setCreating(false);
                    setName("");
                  }
                }}
                placeholder="空间名称"
                className="w-full rounded-s border border-line bg-card px-[8px] py-[5px] text-[14px] text-ink placeholder:text-ink-3 focus:border-accent focus:outline-none"
              />
              <div className="mt-[6px] flex gap-[6px]">
                <button
                  type="button"
                  onClick={() => void handleCreateNamed()}
                  disabled={!name.trim()}
                  className="rounded-s bg-accent px-[10px] py-[4px] text-[13px] text-white transition hover:bg-accent-strong disabled:opacity-30"
                >
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setName("");
                  }}
                  className="rounded-s px-[10px] py-[4px] text-[13px] text-ink-3 transition hover:bg-hover"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[14px] text-ink-2 transition hover:bg-hover"
            >
              <IconPlus className="text-ink-2" />
              新建空间
            </button>
          )}

          <div className="my-[4px] border-t border-line" />

          <button
            type="button"
            onClick={() => {
              setPendingWorkspace(null);
              setOpen(false);
            }}
            className="flex w-full items-center gap-[8px] px-[12px] py-[7px] text-left text-[14px] text-ink-3 transition hover:bg-hover"
          >
            <IconX className="text-ink-2" />
            无工作空间
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Welcome View ────────────────────────────── */

function WelcomeView() {
  const { activeCategory, setActiveCategory } = useUIStore();
  const [text, setText] = useState("");
  const currentTaskId = useSessionStore((s) => s.currentTaskId);
  const createTask = useSessionStore((s) => s.createTask);
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const defaultProviderId = useDefaultProviderId();
  const [welcomeProviderId, setWelcomeProviderId] = useState<string | null>(defaultProviderId);
  const {
    attachments,
    openPicker,
    removeAttachment,
    clear,
    fileInputProps,
    onContainerDragOver,
    onContainerDrop,
  } = useAttachments();

  // 当默认模型变化（如删除模型）时同步欢迎页选择
  const effectiveProviderId = welcomeProviderId ?? defaultProviderId;

  const currentTags = activeCategory === "daily" ? dailyTags : codingTags;

  const handleSend = async () => {
    const raw = text.trim();
    if (!raw && attachments.length === 0) return;
    // 裸 /steer /follow-up：提示不发送（欢迎页无任务可挂通知时静默）
    if (isBareSteerCommand(raw)) {
      if (currentTaskId) {
        useSessionStore
          .getState()
          .pushChatNotice(currentTaskId, "请输入要发送的内容，如：/steer 换个思路", "warn");
      }
      return;
    }
    const cmd = parseCommandChannel(raw);
    const trimmed = cmd ? cmd.rest : raw;
    try {
      let taskId = currentTaskId;
      if (!taskId) {
        const pendingWorkspaceId = useSessionStore.getState().pendingWorkspaceId;
        const task = await createTask(
          pendingWorkspaceId
            ? {
                type: "workspace",
                mode: activeCategory,
                workspaceId: pendingWorkspaceId,
                title: trimmed.slice(0, 30) || "新任务",
                providerId: effectiveProviderId ?? undefined,
              }
            : {
                type: "temp",
                mode: activeCategory,
                title: trimmed.slice(0, 30) || "新任务",
                providerId: effectiveProviderId ?? undefined,
              },
        );
        taskId = task.id;
        // 主页选择的执行模式应用到新任务（plan 需同步进入计划模式）
        const pendingMode = useSessionStore.getState().pendingMode;
        useSessionStore.getState().setMode(taskId, pendingMode);
        if (pendingMode === "plan") {
          void window.electronAPI.agent.extensionCommand({
            taskId,
            extension: "plan-mode",
            command: "toggle",
          });
        }
      }
      const atts = attachments.map((a) => ({ name: a.name, path: a.path, size: a.size }));
      // @ 文件识别：命中 token 剥离为附件（按待选工作空间路径解析；临时任务无目录则保留字面）
      const st = useSessionStore.getState();
      const pendingWs = st.workspaces.find((w) => w.id === st.pendingWorkspaceId);
      const { clean, attachments: mentionAtts } = await resolveMentions(trimmed, pendingWs?.path);
      setText("");
      clear();
      await sendMessage(taskId, clean, [...atts, ...mentionAtts], cmd?.channel);
    } catch (err) {
      console.error("[WelcomeView] 发送失败:", err);
    }
  };

  // / 命令弹窗 + 回车/IME 组合态守卫（欢迎页无任务时命令列表为空，弹窗不出现）
  const slash = useSlashCommands({
    taskId: currentTaskId,
    mode: activeCategory,
    setText,
    onSend: () => void handleSend(),
  });

  return (
    <div className="flex min-h-full flex-col items-center">
      {/* ── Centered Content ── */}
      <div className="flex w-full max-w-[600px] flex-col items-center pt-[130px]">
        {/* Brand icon（public/assets/icon-256.png，图标自带圆角，无需容器） */}
        <img
          src="./assets/icon-256.png"
          alt="EveryBuddy"
          draggable={false}
          className="mb-[20px] h-[72px] w-[72px] select-none"
        />

        {/* Title */}
        <h1 className="font-display text-[36px] font-semibold tracking-tight text-ink">
          EveryBuddy, 我帮你
        </h1>

        {/* Mode Tabs */}
        <div className="mt-[24px] flex gap-[8px]">
          {modes.map((mode) => {
            const isActive = activeCategory === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => setActiveCategory(mode.id)}
                className={`h-[36px] rounded-full px-[20px] text-[15px] font-semibold transition active:scale-[0.97] ${
                  isActive ? "bg-ink text-card" : "bg-hover text-ink-2 hover:bg-active"
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* ── Input Area ── */}
        <div className="mt-[24px] w-[700px]">
          <input type="file" multiple {...fileInputProps} />
          {/* Quick Tags - above input, left-aligned, same width */}
          {currentTags.length > 0 && (
            <div className="mb-[10px] flex justify-start gap-[12px]">
              {currentTags.map((tag) => (
                <button
                  key={tag.id}
                  type="button"
                  className="flex h-[32px] items-center gap-[6px] rounded-full border border-line bg-card px-[14px] text-[14px] text-ink-2 transition hover:border-line-strong hover:bg-hover"
                >
                  <IconClock size={12} className="text-ink-3" />
                  {tag.label}
                </button>
              ))}
            </div>
          )}

          {/* 附件预览条 */}
          <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />

          {/* biome-ignore lint/a11y/noStaticElementInteractions: 输入容器是拖放区，需挂 onDragOver/onDrop；键盘用户聚焦内部 textarea 即可 */}
          <div
            ref={slash.containerRef}
            className="relative h-[160px] rounded-xl border border-line bg-card shadow-card transition focus-within:border-accent"
            onDragOver={onContainerDragOver}
            onDrop={onContainerDrop}
          >
            <SlashCommandMenu
              open={slash.open}
              items={slash.items}
              highlightIndex={slash.highlightIndex}
              onSelect={(i) => {
                const cmd = slash.items[i];
                if (cmd) slash.selectCommand(cmd);
              }}
            />
            <textarea
              value={text}
              onChange={(e) => slash.handleChange(e.target.value)}
              onKeyDown={slash.handleKeyDown}
              onCompositionStart={() => (slash.composingRef.current = true)}
              onCompositionEnd={() => (slash.composingRef.current = false)}
              placeholder="今天帮你做些什么？"
              rows={3}
              className="h-full w-full resize-none border-0 bg-transparent px-[20px] pt-[20px] text-[17px] text-ink placeholder:text-ink-3 focus:outline-none"
            />

            {/* Bottom toolbar */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-[14px] pb-[10px]">
              <div className="flex items-center gap-[16px]">
                <button
                  type="button"
                  onClick={openPicker}
                  title="添加附件"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
                >
                  <IconPlus />
                </button>
                <span className="text-[14px] text-ink-3">@引用对话文件，/调用技能与指令</span>
              </div>

              <div className="flex items-center gap-[6px]">
                {/* 执行模式下拉（主页无任务，选中记为 pending，建对话时应用） */}
                <ModeSelect taskId={currentTaskId} />
                {/* Model selector */}
                <ModelSelector
                  selectedId={effectiveProviderId}
                  onSelect={(id) => {
                    setWelcomeProviderId(id);
                    // 选择聊天模型即设为该类型的激活模型，新建任务默认使用
                    void useUIStore.getState().setActiveModel(id);
                  }}
                  onOpenSettings={() => setSettingsOpen(true)}
                />

                {/* Mic */}
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
                >
                  <IconMic />
                </button>

                {/* Send */}
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!text.trim() && attachments.length === 0}
                  className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-strong active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <IconArrowUp strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="mt-[14px] flex w-[700px] items-center justify-between">
          <WorkspaceSelector />
        </div>
      </div>
    </div>
  );
}

/* ── Chat View ───────────────────────────────── */

function ChatView({ taskId }: { taskId: string }) {
  const { task, messages } = useSessionStore(
    useShallow((s) => {
      const t = s.tasks.find((item) => item.id === taskId);
      return { task: t, messages: t?.messages ?? [] };
    }),
  );

  const [text, setText] = useState("");
  const sendMessage = useSessionStore((s) => s.sendMessage);
  const abortTask = useSessionStore((s) => s.abortTask);
  const setTaskProvider = useSessionStore((s) => s.setTaskProvider);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const defaultProviderId = useDefaultProviderId();
  const {
    attachments,
    openPicker,
    removeAttachment,
    clear,
    fileInputProps,
    onContainerDragOver,
    onContainerDrop,
  } = useAttachments();

  const taskProviderId = task?.providerId ?? defaultProviderId;
  const taskCwd = task?.workspacePath ?? task?.workDir;
  const isStreaming = task?.isStreaming ?? false;
  const hydrating = useSessionStore((s) => s.hydratingIds.includes(taskId));
  const chatNotices = useSessionStore((s) => s.chatNotices[taskId]);
  const notices = chatNotices ?? [];
  const dismissChatNotice = useSessionStore((s) => s.dismissChatNotice);
  const pushChatNotice = useSessionStore((s) => s.pushChatNotice);
  // 运行中发送选择器（转向 / 排队 / 取消）
  const [chooserOpen, setChooserOpen] = useState(false);
  const [chooserText, setChooserText] = useState("");
  // @ 文件识别（textarea ref 供光标处插入）
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mention = useFileMentions({ cwd: taskCwd, text, setText, textareaRef });

  // 自动滚动到底部：仅当用户已在底部附近时，避免打断查看历史
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: 需在消息变化时触发自动滚动（effect 仅引用 ref，deps 用于触发时机）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const groups = useMemo(() => groupMessages(messages), [messages]);

  /** 发送：剥离 /steer /follow-up 前缀路由 channel；裸命令提示不发送；运行中非命令输入弹选择器 */
  const handleSend = async () => {
    const raw = text.trim();
    if (!raw && attachments.length === 0) return;
    // 裸 /steer /follow-up：提示不发送
    if (isBareSteerCommand(raw)) {
      pushChatNotice(
        taskId,
        "请输入要发送的内容，如：/steer 换个思路 或 /follow-up 稍后处理",
        "warn",
      );
      return;
    }
    const cmd = parseCommandChannel(raw);
    // 运行中 + 普通文本 → 弹「转向 / 排队 / 取消」选择器，不直接发送
    if (isStreaming && !cmd) {
      setChooserText(raw);
      setChooserOpen(true);
      return;
    }
    const content = cmd ? cmd.rest : raw;
    const atts = attachments.map((a) => ({ name: a.name, path: a.path, size: a.size }));
    // @ 文件识别：命中的 token 剥离为附件（未命中保留字面）
    const { clean, attachments: mentionAtts } = await resolveMentions(content, taskCwd);
    setText("");
    clear();
    setChooserOpen(false);
    try {
      await sendMessage(taskId, clean, [...atts, ...mentionAtts], cmd?.channel);
    } catch (err) {
      console.error("[ChatView] 发送失败:", err);
    }
  };

  /** 选择器确认：按 channel 路由发送（附件 + @引用一并携带） */
  const doChoose = async (channel: "steer" | "followUp") => {
    const content = chooserText;
    const atts = attachments.map((a) => ({ name: a.name, path: a.path, size: a.size }));
    const { clean, attachments: mentionAtts } = await resolveMentions(content, taskCwd);
    setText("");
    clear();
    setChooserOpen(false);
    void sendMessage(taskId, clean, [...atts, ...mentionAtts], channel).catch((err) =>
      console.error("[ChatView] 发送失败:", err),
    );
  };

  // / 命令弹窗 + 回车/IME 组合态守卫；执行模式经 ModeSelect 下拉切换
  const slash = useSlashCommands({
    taskId,
    mode: task?.mode ?? null,
    setText,
    onSend: () => void handleSend(),
  });

  /** 键盘：@ 菜单 > 运行中选择器 > / 命令，逐级消费 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // @ 菜单开 → mention 处理（Enter 选中文件/进目录，不发送）
    if (mention.handleKeyDown(e)) return;
    // 运行中发送选择器打开 → Enter 不重发、Esc 关闭
    if (chooserOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        setChooserOpen(false);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return;
      }
      return;
    }
    slash.handleKeyDown(e);
  };

  /** 输入变化：/ 命令开合 + @ 文件识别开合 */
  const handleChange = (value: string) => {
    slash.handleChange(value);
    mention.onTextChange(value);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-6 py-6">
        {/* 对话内居中提示条（计划模式切换等 extension_notify，4s 自动消失） */}
        {notices.length > 0 && (
          <div className="mx-auto mb-3 flex w-full max-w-3xl flex-col items-center gap-2">
            {notices.map((n) => (
              <div
                key={n.id}
                role="status"
                className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-1.5 text-[12px] text-ink-2 shadow-card"
              >
                <span className="whitespace-pre-wrap">{n.message}</span>
                <button
                  type="button"
                  onClick={() => dismissChatNotice(taskId, n.id)}
                  aria-label="关闭"
                  className="shrink-0 rounded-full px-1 text-ink-3 transition hover:bg-hover hover:text-ink"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center">
            <p className="text-sm text-ink-3">
              {hydrating ? "加载历史中…" : "新会话，发送消息开始对话"}
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {groups.map((g) => {
              const first = g.messages[0];
              if (!first) return null;
              return g.kind === "assistant" ? (
                <AssistantGroup key={first.id} messages={g.messages} taskId={taskId} />
              ) : g.kind === "notice" ? (
                <CompactionNoticeCard key={first.id} summary={first.noticeContent ?? ""} />
              ) : (
                <MessageBubble key={first.id} message={first} />
              );
            })}
            {/* 等待首个 assistant 消息的空白期（已发送未首响应）：末尾「运行中」指示 */}
            {task?.pending && !task.isStreaming && <RunningIndicator />}
          </div>
        )}
      </div>

      {/* Chat input */}
      <div className="bg-paper px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <input type="file" multiple {...fileInputProps} />
          {/* 附件预览条 */}
          <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />
          {/* 工具权限确认提示条（手动模式下显示在输入框上方） */}
          <ToolApprovalBar taskId={taskId} />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: 输入容器是拖放区，需挂 onDragOver/onDrop；键盘用户聚焦内部 textarea 即可 */}
          <div
            ref={slash.containerRef}
            className="relative h-[120px] rounded-xl border border-line bg-card shadow-card transition focus-within:border-accent"
            onDragOver={onContainerDragOver}
            onDrop={onContainerDrop}
          >
            <SlashCommandMenu
              open={slash.open}
              items={slash.items}
              highlightIndex={slash.highlightIndex}
              onSelect={(i) => {
                const cmd = slash.items[i];
                if (cmd) slash.selectCommand(cmd);
              }}
            />
            {/* @ 文件识别下拉 */}
            <FileMentionMenu
              open={mention.open}
              loading={mention.loading}
              entries={mention.entries}
              path={mention.path}
              highlightIndex={mention.highlightIndex}
              onNavigate={mention.navigate}
              onGoRoot={mention.goRoot}
              onGoCrumb={mention.goCrumb}
              onSelect={mention.insertMention}
            />
            {/* 运行中发送选择器：转向 / 排队 / 取消 */}
            <SendModeChooser
              open={chooserOpen}
              onSteer={() => void doChoose("steer")}
              onQueue={() => void doChoose("followUp")}
              onCancel={() => setChooserOpen(false)}
            />
            {/* 排队区（followUp 驻留，可折叠/展开 + 单项取消；仅非选择器时显示） */}
            {!chooserOpen && <PendingQueueBar taskId={taskId} />}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => handleChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onCompositionStart={() => (slash.composingRef.current = true)}
              onCompositionEnd={() => (slash.composingRef.current = false)}
              placeholder="今天帮你做些什么？ @引用对话文件，/调用技能与指令"
              rows={2}
              className="h-full w-full resize-none border-0 bg-transparent px-[20px] pt-[16px] text-[17px] text-ink placeholder:text-ink-3 focus:outline-none"
            />
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-[14px] pb-[10px]">
              <div className="flex items-center gap-[4px]">
                <button
                  type="button"
                  onClick={openPicker}
                  title="添加附件"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
                >
                  <IconPlus />
                </button>
              </div>
              <div className="flex items-center gap-[6px]">
                {/* 执行模式下拉（自动/手动/计划），紧挨模型选择器 */}
                <ModeSelect taskId={taskId} />
                <ModelSelector
                  selectedId={taskProviderId}
                  onSelect={(id) => setTaskProvider(taskId, id)}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
                <button
                  type="button"
                  className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-ink-2 transition hover:bg-hover hover:text-ink"
                >
                  <IconMic />
                </button>
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={() => void abortTask(taskId)}
                    title="停止生成"
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-strong active:scale-95"
                  >
                    <IconStop size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={!text.trim() && attachments.length === 0}
                    className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-accent text-white transition hover:bg-accent-strong active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <IconArrowUp strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
