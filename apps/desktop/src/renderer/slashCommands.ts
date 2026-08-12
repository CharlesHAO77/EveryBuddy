/**
 * / 命令注册表与匹配/过滤纯函数（无 React 依赖，可单测）。
 */

import { useSessionStore } from "./stores/sessionStore";

export interface SlashCommandCtx {
  /** 当前任务 id；欢迎页无任务时为 null */
  taskId: string | null;
  /** 当前 agent 模式（daily/coding）；未知为 null */
  mode: "daily" | "coding" | null;
}

export interface SlashCommand {
  /** 命令关键字（/ 后部分） */
  id: string;
  label: string;
  description?: string;
  when?: (ctx: SlashCommandCtx) => boolean;
  run: (ctx: SlashCommandCtx) => void;
  /**
   * 选中后直接插入输入框的前缀（非空时不调 run，保持 textarea 焦点等待继续输入）。
   * 用于 /steer /follow-up 这类「命令 + 参数」的扩展命令。
   */
  insertPrefix?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "steer",
    label: "转向",
    description: "打断当前生成，转向新指令",
    insertPrefix: "/steer ",
    run: () => {},
  },
  {
    id: "follow-up",
    label: "排队",
    description: "排队处理，当前生成完成后自动发送",
    insertPrefix: "/follow-up ",
    run: () => {},
  },
  {
    id: "plan",
    label: "切换计划模式",
    description: "进入/退出计划模式（只读探索）",
    run: (ctx) => {
      const store = useSessionStore.getState();
      if (!ctx.taskId) {
        // 欢迎页无任务：仅切换 pendingMode，创建对话时由 WelcomeView 应用到新任务
        store.setPendingMode(store.pendingMode === "plan" ? "auto" : "plan");
        return;
      }
      const planState = store.extensionStates[ctx.taskId]?.["plan-mode"]?.state;
      const planOn = planState === "plan" || planState === "ready" || planState === "executing";
      void window.electronAPI.agent.extensionCommand({
        taskId: ctx.taskId,
        extension: "plan-mode",
        command: "toggle",
      });
      // 同步模式存储：进入写回 "plan"、退出回退 "auto"，按钮立即反映切换，
      // 不再只依赖异步 extension_status 事件落地（该事件延迟/丢失时显示仍会滞后）
      store.setMode(ctx.taskId, planOn ? "auto" : "plan");
    },
  },
];

/** 整个输入恰好是 `/keyword`（keyword 可空，`/` 即全量）时返回 keyword，否则 null */
export function matchSlash(text: string): string | null {
  const m = /^\/([a-zA-Z0-9_-]*)$/.exec(text.trim());
  return m ? (m[1] ?? "") : null;
}

/** 按关键字过滤命令（id/label 前缀或包含），并应用 when 拦截 */
export function filterSlashCommands(keyword: string, ctx: SlashCommandCtx): SlashCommand[] {
  const kw = keyword.toLowerCase();
  return SLASH_COMMANDS.filter(
    (c) =>
      (!c.when || c.when(ctx)) &&
      (c.id.toLowerCase().includes(kw) || c.label.toLowerCase().includes(kw)),
  );
}

/** 解析扩展命令输入：`/steer 内容` / `/follow-up 内容` → { channel, rest }；裸命令或普通文本返回 null */
export function parseCommandChannel(text: string): { channel: "steer" | "followUp"; rest: string } | null {
  const m = /^\/(steer|follow-up)\s+(.+)$/s.exec(text.trim());
  if (!m) return null;
  const cmd = m[1];
  const rest = m[2];
  if (cmd === undefined || rest === undefined) return null;
  return { channel: cmd === "steer" ? "steer" : "followUp", rest: rest.trim() };
}

/** 是否为裸扩展命令（`/steer` / `/follow-up` 无参数，需提示不发送） */
export function isBareSteerCommand(text: string): boolean {
  return /^\/(steer|follow-up)\s*$/.test(text.trim());
}
