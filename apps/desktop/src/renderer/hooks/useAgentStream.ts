/**
 * useAgentStream - 订阅 agent:event 流并更新 sessionStore（见 docs/architecture.md §9.1, §0.4）。
 *
 * 在 App 顶层调用一次。事件按内容块粒度分发到 store 的流式块操作。
 */

import type { AgentEvent } from "@everybuddy/ipc-contract";
import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";
import { useToastStore } from "../stores/toastStore";

export function useAgentStream(): void {
  useEffect(() => {
    const unsubscribe = window.electronAPI.agent.onEvent((event: AgentEvent) => {
      const store = useSessionStore.getState();
      const taskId = event.streamId;

      switch (event.type) {
        case "message_start":
          store.startAssistantMessage(taskId);
          break;
        case "message_end":
          // 单条 LLM response 结束：内容块已完整，兜底关闭未闭合的 thinking/text 块。
          // 不结束消息级流式--工具可能仍在 message_end 之后执行
          store.closeContentBlocks(taskId);
          break;
        case "error":
          store.addErrorMessage(taskId, event.payload.message);
          break;
        case "turn_end":
          // 单个 turn 结束，但 agent 消息可能还有后续 turn；不 finalize
          break;
        case "agent_end":
        case "agent_settled":
          // agent 消息真正结束（所有 turn 完成、无重试）才 finalize
          store.finalizeMessage(taskId);
          break;

        // 思考块
        case "thinking_start":
          store.startBlock(taskId, event.payload.contentIndex, "thinking");
          break;
        case "thinking_delta":
          store.appendBlockDelta(taskId, event.payload.contentIndex, event.payload.delta);
          break;
        case "thinking_end":
          store.endBlock(taskId, event.payload.contentIndex, event.payload.content);
          break;

        // 文本块（重点）
        case "text_start":
          store.startBlock(taskId, event.payload.contentIndex, "text");
          break;
        case "text_delta":
          store.appendBlockDelta(taskId, event.payload.contentIndex, event.payload.delta);
          break;
        case "text_end":
          store.endBlock(taskId, event.payload.contentIndex, event.payload.content);
          break;

        // 工具调用块
        case "toolcall_start":
          store.startBlock(taskId, event.payload.contentIndex, "tool", event.payload.toolCallId);
          break;
        case "toolcall_delta":
          store.appendBlockDelta(taskId, event.payload.contentIndex, event.payload.delta);
          break;
        case "toolcall_end":
          store.setToolCallInfo(taskId, event.payload.contentIndex, {
            toolCallId: event.payload.toolCall.id,
            name: event.payload.toolCall.name,
            arguments: event.payload.toolCall.arguments,
          });
          break;

        // 工具执行
        case "tool_execution_start":
          store.startToolExecution(
            taskId,
            event.payload.toolCallId,
            event.payload.toolName,
            event.payload.args,
          );
          break;
        case "tool_execution_update":
          store.appendToolDelta(taskId, event.payload.toolCallId, event.payload.delta);
          break;
        case "tool_execution_end":
          store.endToolExecution(
            taskId,
            event.payload.toolCallId,
            event.payload.ok,
            event.payload.output,
            event.payload.error,
          );
          break;

        // 工具权限确认（手动模式下副作用工具调用前暂停，等待人工应答）
        case "tool_approval_required":
          store.pushToolApproval(taskId, {
            requestId: event.payload.requestId,
            toolCallId: event.payload.toolCallId,
            toolName: event.payload.toolName,
            args: event.payload.args,
            isDangerous: event.payload.isDangerous,
          });
          // 本会话已「总是允许」该工具 → 直接自动批准，不再弹提示条
          if (store.isToolAlwaysAllowed(taskId, event.payload.toolName)) {
            void window.electronAPI.agent.approveTool({
              taskId,
              requestId: event.payload.requestId,
              approved: true,
            });
            store.removeToolApproval(taskId, event.payload.requestId);
          }
          break;

        // 扩展状态（plan-mode 的 value/lines/state，todo 的待办列表）
        case "extension_status":
          store.setExtensionStatus(taskId, event.payload.key, {
            value: event.payload.value,
            lines: event.payload.lines,
            state: event.payload.state,
          });
          break;
        // 扩展通知（瞬时提示）
        case "extension_notify":
          useToastStore.getState().push({
            message: event.payload.message,
            level: event.payload.level,
          });
          break;
      }
    });
    return unsubscribe;
  }, []);
}
