/**
 * Todo Extension（桌面适配版）
 *
 * 注册 `todo` 工具供 LLM 管理待办列表（list/add/toggle/clear）。
 * 状态存于工具结果 details 中（支持分支历史正确还原），session 启动/切分支时从历史重建。
 * 原始 TUI 组件（TodoListComponent / renderCall / renderResult / /todos 命令）已移除，
 * 改为经 Emit 推送 extension_status 让渲染进程展示当前待办。
 *
 * 注意：pi-ai / typebox 均为 ESM-only，主进程 CJS bundle 不能静态 import，
 * typebox 须在 async factory 内动态 import（见 agentRuntime buildParseAttachmentTool 同款做法）。
 */

import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { Emit, ExtensionHandle } from "./types";

interface Todo {
  id: number;
  text: string;
  done: boolean;
}

interface TodoDetails {
  action: "list" | "add" | "toggle" | "clear";
  todos: Todo[];
  nextId: number;
  error?: string;
}

export interface TodoController {
  getTodos(): Todo[];
}

export function createTodoExtension(emit: Emit): ExtensionHandle {
  let todos: Todo[] = [];
  let nextId = 1;

  function emitTodos(): void {
    const done = todos.filter((t) => t.done).length;
    emit({
      type: "extension_status",
      payload: {
        key: "todo",
        value: todos.length ? `📝 ${done}/${todos.length}` : undefined,
        lines: todos.length ? todos.map((t) => `${t.done ? "☑" : "☐"} ${t.text}`) : undefined,
      },
    });
  }

  function reconstructState(ctx: ExtensionContext): void {
    todos = [];
    nextId = 1;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "toolResult" || msg.toolName !== "todo") continue;
      const details = msg.details as TodoDetails | undefined;
      if (details) {
        todos = details.todos;
        nextId = details.nextId;
      }
    }
    emitTodos();
  }

  const controller: TodoController = {
    getTodos: () => [...todos],
  };

  const factory: ExtensionFactory = async (pi: ExtensionAPI) => {
    // typebox 为 ESM-only，主进程 CJS bundle 须动态 import（SDK loader 会 await factory）
    const { Type } = await import("typebox");

    const TodoParams = Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("add"),
        Type.Literal("toggle"),
        Type.Literal("clear"),
      ]),
      text: Type.Optional(Type.String({ description: "Todo text (for add)" })),
      id: Type.Optional(Type.Number({ description: "Todo ID (for toggle)" })),
    });

    pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
    pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));

    pi.registerTool({
      name: "todo",
      label: "Todo",
      description:
        "管理待办列表。动作：list（列出）、add（新增，需 text）、toggle（切换完成，需 id）、clear（清空）",
      parameters: TodoParams,

      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        let result: AgentToolResult<TodoDetails>;
        switch (params.action) {
          case "list":
            result = {
              content: [
                {
                  type: "text",
                  text: todos.length
                    ? todos.map((t) => `[${t.done ? "x" : " "}] #${t.id}: ${t.text}`).join("\n")
                    : "No todos",
                },
              ],
              details: { action: "list", todos: [...todos], nextId } as TodoDetails,
            };
            break;

          case "add": {
            if (!params.text) {
              result = {
                content: [{ type: "text", text: "Error: text required for add" }],
                details: {
                  action: "add",
                  todos: [...todos],
                  nextId,
                  error: "text required",
                } as TodoDetails,
              };
              break;
            }
            const newTodo: Todo = { id: nextId++, text: params.text, done: false };
            todos.push(newTodo);
            result = {
              content: [{ type: "text", text: `Added todo #${newTodo.id}: ${newTodo.text}` }],
              details: { action: "add", todos: [...todos], nextId } as TodoDetails,
            };
            break;
          }

          case "toggle": {
            if (params.id === undefined) {
              result = {
                content: [{ type: "text", text: "Error: id required for toggle" }],
                details: {
                  action: "toggle",
                  todos: [...todos],
                  nextId,
                  error: "id required",
                } as TodoDetails,
              };
              break;
            }
            const todo = todos.find((t) => t.id === params.id);
            if (!todo) {
              result = {
                content: [{ type: "text", text: `Todo #${params.id} not found` }],
                details: {
                  action: "toggle",
                  todos: [...todos],
                  nextId,
                  error: `#${params.id} not found`,
                } as TodoDetails,
              };
              break;
            }
            todo.done = !todo.done;
            result = {
              content: [
                {
                  type: "text",
                  text: `Todo #${todo.id} ${todo.done ? "completed" : "uncompleted"}`,
                },
              ],
              details: { action: "toggle", todos: [...todos], nextId } as TodoDetails,
            };
            break;
          }

          case "clear": {
            const count = todos.length;
            todos = [];
            nextId = 1;
            result = {
              content: [{ type: "text", text: `Cleared ${count} todos` }],
              details: { action: "clear", todos: [], nextId: 1 } as TodoDetails,
            };
            break;
          }

          default:
            result = {
              content: [{ type: "text", text: `Unknown action: ${params.action}` }],
              details: {
                action: "list",
                todos: [...todos],
                nextId,
                error: `unknown action: ${params.action}`,
              } as TodoDetails,
            };
            break;
        }
        emitTodos();
        return result;
      },
    });
  };

  return { factory, controller, tools: ["todo"] };
}
