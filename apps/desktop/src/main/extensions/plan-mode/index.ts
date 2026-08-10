/**
 * Plan Mode Extension（桌面适配版）
 *
 * 只读探索模式：启用后内置写入工具禁用，Bash 仅允许白名单只读命令。
 * 行为钩子（pi.on / setActiveTools / appendEntry）原样保留自 pi TUI 版；
 * UI 反馈改为经 Emit 推送 extension_status / extension_notify 到渲染进程；
 * 触发入口（切换 / 执行）改为控制器侧信道，由 ipcRouter:agent:extension-command 调用。
 */

import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ContextEvent, ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { Emit, ExtensionHandle } from "../types";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils";

/** pi 消息类型（AgentMessage 经 SDK 事件类型间接取得，避免直接依赖 pi-agent-core） */
type ExtensionMessage = ContextEvent["messages"][number];

// 计划模式可用的只读工具（不含 questionnaire，桌面端未注册）
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];
const PLAN_MODE_DISABLED_TOOLS = new Set<string>(["edit", "write"]);
const PLAN_MANAGED_TOOLS = new Set<string>([...PLAN_MODE_TOOLS, ...NORMAL_MODE_TOOLS]);

interface PlanModePersistedState {
  enabled: boolean;
  todos?: TodoItem[];
  executing?: boolean;
  toolsBeforePlanMode?: string[];
}

export interface PlanModeState {
  enabled: boolean;
  executing: boolean;
  todos: TodoItem[];
}

export interface PlanModeController {
  toggle(): void;
  execute(): void;
  getState(): PlanModeState;
}

function isAssistantMessage(m: ExtensionMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export function createPlanModeExtension(emit: Emit): ExtensionHandle {
  let pi: ExtensionAPI | null = null;
  let planModeEnabled = false;
  let executionMode = false;
  let todoItems: TodoItem[] = [];
  let toolsBeforePlanMode: string[] | undefined;

  function emitStatus(): void {
    if (executionMode && todoItems.length > 0) {
      // 执行中：进度 + 步骤清单
      const completed = todoItems.filter((t) => t.completed).length;
      emit({
        type: "extension_status",
        payload: {
          key: "plan-mode",
          state: "executing",
          value: `📋 ${completed}/${todoItems.length}`,
          lines: todoItems.map((t) => `${t.completed ? "☑" : "☐"} ${t.text}`),
        },
      });
    } else if (planModeEnabled && todoItems.length > 0) {
      // 计划已提取，等待执行
      emit({
        type: "extension_status",
        payload: {
          key: "plan-mode",
          state: "ready",
          value: `📋 计划 ${todoItems.length} 步`,
          lines: todoItems.map((t) => `☐ ${t.text}`),
        },
      });
    } else if (planModeEnabled) {
      emit({ type: "extension_status", payload: { key: "plan-mode", state: "plan", value: "⏸ plan" } });
    } else {
      emit({ type: "extension_status", payload: { key: "plan-mode", state: "off", value: undefined } });
    }
  }

  function uniqueToolNames(toolNames: string[]): string[] {
    return [...new Set(toolNames)];
  }

  function getPlanModeTools(activeToolNames: string[]): string[] {
    return uniqueToolNames([
      ...activeToolNames.filter((name) => !PLAN_MODE_DISABLED_TOOLS.has(name)),
      ...PLAN_MODE_TOOLS,
    ]);
  }

  function getNormalModeTools(activeToolNames: string[]): string[] {
    return uniqueToolNames([
      ...NORMAL_MODE_TOOLS,
      ...activeToolNames.filter((name) => !PLAN_MANAGED_TOOLS.has(name)),
    ]);
  }

  function enablePlanModeTools(): void {
    if (!pi) return;
    if (toolsBeforePlanMode === undefined) {
      toolsBeforePlanMode = pi.getActiveTools();
    }
    pi.setActiveTools(getPlanModeTools(toolsBeforePlanMode));
  }

  function restoreNormalModeTools(): void {
    if (!pi) return;
    pi.setActiveTools(toolsBeforePlanMode ?? getNormalModeTools(pi.getActiveTools()));
    toolsBeforePlanMode = undefined;
  }

  function persistState(): void {
    if (!pi) return;
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
      toolsBeforePlanMode,
    });
  }

  function togglePlanMode(): void {
    planModeEnabled = !planModeEnabled;
    executionMode = false;
    todoItems = [];

    if (planModeEnabled) {
      enablePlanModeTools();
      emit({
        type: "extension_notify",
        payload: { message: "已进入计划模式（只读探索），写入工具已禁用", level: "info" },
      });
    } else {
      restoreNormalModeTools();
      emit({
        type: "extension_notify",
        payload: { message: "已退出计划模式，恢复完整工具访问", level: "info" },
      });
    }
    emitStatus();
    persistState();
  }

  function executePlan(): void {
    if (!pi || todoItems.length === 0) return;
    const firstTodoItem = todoItems[0];
    if (!firstTodoItem) return;
    planModeEnabled = false;
    executionMode = true;
    restoreNormalModeTools();
    emitStatus();
    persistState();

    const remainingList = todoItems.map((t) => `${t.step}. ${t.text}`).join("\n");
    const execMessage = `Execute the plan.

Remaining steps:
${remainingList}

Start with: ${firstTodoItem.text}
After completing a step, include a [DONE:n] tag in your response.`;
    try {
      pi.sendMessage(
        { customType: "plan-mode-execute", content: execMessage, display: false },
        { triggerTurn: true },
      );
    } catch {
      emit({
        type: "extension_notify",
        payload: { message: "执行模式已启动，发送消息以开始第一步", level: "info" },
      });
    }
  }

  const controller: PlanModeController = {
    toggle: togglePlanMode,
    execute: executePlan,
    getState: () => ({ enabled: planModeEnabled, executing: executionMode, todos: todoItems }),
  };

  const factory: ExtensionFactory = (api: ExtensionAPI) => {
    pi = api;

    pi.registerFlag("plan", {
      description: "Start in plan mode (read-only exploration)",
      type: "boolean",
      default: false,
    });

    // 计划模式下拦截危险 bash
    pi.on("tool_call", async (event) => {
      if (!planModeEnabled || event.toolName !== "bash") return;
      const command = event.input.command as string;
      if (!isSafeCommand(command)) {
        return {
          block: true,
          reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
        };
      }
    });

    // 非计划模式时过滤掉残留的 plan-mode 上下文消息
    pi.on("context", async (event) => {
      if (planModeEnabled) return;
      return {
        messages: event.messages.filter((m) => {
          const msg = m as ExtensionMessage & { customType?: string };
          if (msg.customType === "plan-mode-context") return false;
          if (msg.role !== "user") return true;
          const content = msg.content;
          if (typeof content === "string") {
            return !content.includes("[PLAN MODE ACTIVE]");
          }
          if (Array.isArray(content)) {
            return !content.some(
              (c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
            );
          }
          return true;
        }),
      };
    });

    // agent 开始前注入计划/执行上下文
    pi.on("before_agent_start", async () => {
      if (planModeEnabled) {
        return {
          message: {
            customType: "plan-mode-context",
            content: `[PLAN MODE ACTIVE]
你处于计划模式 —— 只读探索，用于安全的代码分析。

限制：
- 内置 edit/write 工具已禁用
- 其余当前激活的工具仍可用
- Bash 仅允许白名单内的只读命令

请在 "Plan:" 标题下给出编号计划：

Plan:
1. 第一步描述
2. 第二步描述
...

不要直接修改代码，只描述你将如何做。`,
            display: false,
          },
        };
      }
      if (executionMode && todoItems.length > 0) {
        const remaining = todoItems.filter((t) => !t.completed);
        const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
        return {
          message: {
            customType: "plan-execution-context",
            content: `[EXECUTING PLAN - 完整工具已恢复]

剩余步骤：
${todoList}

按顺序执行每一步。完成一步后，在回复中包含 [DONE:n] 标记。`,
            display: false,
          },
        };
      }
    });

    // 每轮结束后追踪进度
    pi.on("turn_end", async (event) => {
      if (!executionMode || todoItems.length === 0) return;
      if (!isAssistantMessage(event.message)) return;
      const text = getTextContent(event.message);
      if (markCompletedSteps(text, todoItems) > 0) {
        emitStatus();
      }
      persistState();
    });

    // 处理计划完成 / 提取计划步骤
    pi.on("agent_end", async (event) => {
      if (!pi) return;
      // 执行模式：检查是否全部完成
      if (executionMode && todoItems.length > 0) {
        if (todoItems.every((t) => t.completed)) {
          const completedList = todoItems.map((t) => `~~${t.text}~~`).join("\n");
          pi.sendMessage(
            {
              customType: "plan-complete",
              content: `**计划完成！** ✓\n\n${completedList}`,
              display: true,
            },
            { triggerTurn: false },
          );
          executionMode = false;
          todoItems = [];
          emitStatus();
          persistState(); // 保存清空后的状态，避免 resume 恢复旧执行态
        }
        return;
      }

      if (!planModeEnabled) return;

      // 从最后一条 assistant 消息提取计划步骤
      const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
      if (lastAssistant) {
        const extracted = extractTodoItems(getTextContent(lastAssistant));
        if (extracted.length > 0) {
          todoItems = extracted;
        }
      }

      if (todoItems.length === 0) return;
      persistState();
      emitStatus();
      emit({
        type: "extension_notify",
        payload: {
          message: `计划已就绪（${todoItems.length} 步），点击「执行计划」开始，或继续对话修订`,
          level: "info",
        },
      });
    });

    // session 启动/恢复时还原状态
    pi.on("session_start", async (_event, ctx) => {
      if (pi?.getFlag("plan") === true) {
        planModeEnabled = true;
      }

      const entries = ctx.sessionManager.getEntries();

      const planModeEntry = entries
        .filter(
          (e: { type: string; customType?: string }) =>
            e.type === "custom" && e.customType === "plan-mode",
        )
        .pop() as { data?: PlanModePersistedState } | undefined;

      if (planModeEntry?.data) {
        planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
        todoItems = planModeEntry.data.todos ?? todoItems;
        executionMode = planModeEntry.data.executing ?? executionMode;
        toolsBeforePlanMode = planModeEntry.data.toolsBeforePlanMode ?? toolsBeforePlanMode;
      }

      // 恢复时重新扫描消息以重建完成状态（仅扫描最后一次 plan-mode-execute 之后的消息）
      const isResume = planModeEntry !== undefined;
      if (isResume && executionMode && todoItems.length > 0) {
        let executeIndex = -1;
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          if (entry && "customType" in entry && entry.customType === "plan-mode-execute") {
            executeIndex = i;
            break;
          }
        }
        const messages: AssistantMessage[] = [];
        for (let i = executeIndex + 1; i < entries.length; i++) {
          const entry = entries[i];
          if (!entry) continue;
          if (
            entry.type === "message" &&
            "message" in entry &&
            isAssistantMessage(entry.message as ExtensionMessage)
          ) {
            messages.push(entry.message as AssistantMessage);
          }
        }
        const allText = messages.map(getTextContent).join("\n");
        markCompletedSteps(allText, todoItems);
      }

      if (planModeEnabled) {
        enablePlanModeTools();
      }
      emitStatus();
    });
  };

  return { factory, controller };
}
