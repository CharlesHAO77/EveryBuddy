/**
 * useAgentStream - 订阅 agent:event 流并更新 sessionStore（见 docs/architecture.md §9.1, §0.4）。
 *
 * 在 App 顶层调用一次。事件按内容块粒度分发到 store 的流式块操作。
 */

import type { AgentEvent } from "@everybuddy/ipc-contract";
import { useEffect } from "react";
import { useSessionStore } from "../stores/sessionStore";

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
          // 单条 LLM response 结束，不结束流式：工具可能仍在执行（tool_execution 在 message_end 之后）
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
      }
    });
    return unsubscribe;
  }, []);
}
