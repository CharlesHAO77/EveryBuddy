/**
 * 工具执行权限扩展（auto / manual / plan）。
 *
 * manual 模式下，副作用工具（bash / edit / write 等）调用前暂停，经 Emit 推送
 * tool_approval_required 到渲染进程，并 await 渲染进程经 agent:approveTool 返回的
 * 应答：批准则放行，拒绝则返回 { block: true } 让工具不执行、错误结果回给 LLM。
 *
 * 实现依赖 SDK 已验证事实：tool_call 扩展 handler 被 SDK await（runner.emitToolCall
 * 逐个 await，agent-loop beforeToolCall 在执行前等待），故 handler 内 await 一个
 * 由 IPC 应答的 Promise 即可阻塞工具直到人工确认 —— 零 SDK 改动。
 *
 * 注意：主进程为 CJS bundle，本文件只允许 type-only 引入 ESM 包（@earendil-works/*），
 * 运行时仅依赖 node:crypto。
 */

import { randomUUID } from "node:crypto";
import type {
  ExtensionAPI,
  ExtensionFactory,
  ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import type { ExecutionMode } from "@everybuddy/ipc-contract";
import type { Emit, ExtensionHandle } from "./types";

/** 只读 / 无副作用工具：手动模式下也不提示，自动放行 */
const NO_PROMPT_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "ls",
  "parse_attachment",
  "understand_image",
  "todo",
]);

/** 副作用工具需提示；未知工具默认提示（安全偏向，未来新增工具不会静默放行） */
export function shouldPromptForTool(toolName: string): boolean {
  return !NO_PROMPT_TOOLS.has(toolName);
}

export interface PermissionController {
  resolve(requestId: string, approved: boolean): void;
  /** 会话关闭时把未应答的请求全部按拒绝处理，避免工具永久阻塞 */
  dispose(): void;
}

export function createPermissionExtension(
  emit: Emit,
  getMode: () => ExecutionMode,
): ExtensionHandle {
  const pending = new Map<string, { resolve: (ok: boolean) => void }>();

  const controller: PermissionController = {
    resolve: (requestId, approved) => {
      const p = pending.get(requestId);
      if (!p) return;
      pending.delete(requestId);
      p.resolve(approved);
    },
    dispose: () => {
      for (const p of pending.values()) p.resolve(false);
      pending.clear();
    },
  };

  const factory: ExtensionFactory = (api: ExtensionAPI) => {
    api.on("tool_call", async (event: ToolCallEvent) => {
      if (getMode() !== "manual") return undefined;
      if (!shouldPromptForTool(event.toolName)) return undefined;

      const requestId = randomUUID();
      emit({
        type: "tool_approval_required",
        payload: {
          requestId,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          args: event.input,
          isDangerous: event.toolName === "bash",
        },
      });

      const approved = await new Promise<boolean>((resolve) => {
        pending.set(requestId, { resolve });
      });
      if (approved) return undefined;
      return { block: true, reason: "用户拒绝执行" };
    });
  };

  return { factory, controller };
}
