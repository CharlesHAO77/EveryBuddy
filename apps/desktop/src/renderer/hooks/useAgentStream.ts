/**
 * useAgentStream - 订阅 agent:event 流并更新 sessionStore（见 docs/architecture.md §9.1, §0.4）。
 *
 * 在 App 顶层调用一次。事件按内容块粒度分发到 store 的流式块操作。
 */

import type { AgentEvent } from "@everybuddy/ipc-contract";
import { useEffect } from "react";
import { type PreviewItem, useSessionStore } from "../stores/sessionStore";
import { useUIStore } from "../stores/uiStore";

export function useAgentStream(): void {
  useEffect(() => {
    const unsubscribe = window.electronAPI.agent.onEvent((event: AgentEvent) => {
      const store = useSessionStore.getState();
      const taskId = event.streamId;

      switch (event.type) {
        case "message_start":
          // 先交付排队/转向：交付的 followUp user 消息插到新 assistant turn 之前；
          // 若存在「转向中」用户消息 → 本次 message_start 即该 steer 的响应 turn：
          // 标记 steerTargetId（首次转向捕获的原始在途消息）为「已转向」并清除目标——
          // 多次转向合并指向同一目标，只有原始 turn 被标记，后续转向的响应不会被误标
          store.flushPendingFollowUps(taskId);
          if (
            useSessionStore
              .getState()
              .tasks.find((t) => t.id === taskId)
              ?.messages.some((m) => m.steerPending)
          ) {
            store.markSteerTargetRedirected(taskId);
          }
          store.clearOldestSteerPending(taskId);
          store.startAssistantMessage(taskId, event.payload.sdkTimestamp);
          break;
        case "message_end":
          // 单条 LLM response 结束：内容块已完整，兜底关闭未闭合的 thinking/text 块。
          // 不结束消息级流式--工具可能仍在 message_end 之后执行
          store.closeContentBlocks(taskId);
          // 取消语义：stopReason "aborted"（真实或主进程合成）→ 标记「已取消」
          if (event.payload.stopReason === "aborted") store.markMessageCancelled(taskId);
          // footer 元数据（usage/model/provider/stopReason）
          store.setMessageMeta(taskId, event.payload);
          break;
        case "message_entry_ids":
          // agent_settled 后下发的 assistant 条目 id 映射（分支锚点）
          store.markMessageEntryIds(taskId, event.payload.entries);
          break;
        case "queue_update":
          // 更新队列状态 + 按 diff 交付已送达的 followUp
          store.handleQueueUpdate(taskId, event.payload);
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
          // 生图完成：把生成图片加入「最近结果」并自动打开右侧栏切到预览
          if (event.payload.toolName === "generate_image" && event.payload.ok) {
            const output = event.payload.output as { details?: { paths?: unknown } } | undefined;
            const paths = Array.isArray(output?.details?.paths)
              ? output.details.paths.filter((p): p is string => typeof p === "string")
              : [];
            if (paths.length > 0) {
              const s = useSessionStore.getState();
              const task = s.tasks.find((t) => t.id === taskId);
              const cwd = task?.workspacePath ?? task?.workDir;
              if (cwd) {
                const items: PreviewItem[] = paths.map((rel) => ({
                  id: crypto.randomUUID(),
                  kind: "image",
                  name: rel.split(/[\\/]/).pop() ?? rel,
                  // 相对路径拼 cwd：混合分隔符由主进程 path.resolve 归一
                  absPath: `${cwd}/${rel}`,
                }));
                s.addPreviewItems(taskId, items);
                s.setPreviewSelection(taskId, items[0]?.id ?? null);
                useUIStore.setState({ rightPanelOpen: true, rightPanelView: "preview" });
              }
            }
          }
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
        case "extension_status": {
          const key = event.payload.key;
          // 读更新前状态，用于判断「关键时机」自动切换（todo 首次出现 / 计划就绪 / 开始执行 / 进入计划模式）
          const prev = store.extensionStates[taskId]?.[key];
          store.setExtensionStatus(taskId, key, {
            value: event.payload.value,
            lines: event.payload.lines,
            state: event.payload.state,
          });
          const nextLines = event.payload.lines;
          const nextState = event.payload.state;
          const shouldShow =
            (key === "todo" && (nextLines?.length ?? 0) > 0 && (prev?.lines?.length ?? 0) === 0) ||
            (key === "plan-mode" &&
              (nextState === "ready" || nextState === "executing") &&
              prev?.state !== nextState);
          if (shouldShow) {
            useUIStore.setState({ rightPanelOpen: true, rightPanelView: "todo-plan" });
          }
          break;
        }
        // 扩展通知（瞬时提示）：放入当前对话消息区居中显示（4s 自动消失），替代右上角 toast
        case "extension_notify":
          store.pushChatNotice(taskId, event.payload.message, event.payload.level);
          break;
      }
    });
    return unsubscribe;
  }, []);
}
