# 交互优化：取消 / 转向 / 排队

> 在 `dialog-experience.md`（第一轮对话体验增强）之上继续打磨三类交互。本轮四个方向均已在实现前与用户确认（含 HTML 效果示意 `docs/demos/interaction-mockup.html`）。

## 背景（要解决的问题）

| 场景 | 问题 | 目标 |
|---|---|---|
| 取消 | 只显示红色 pill「任务已取消」+ 平铺内容，与「任务已完成」折叠卡不对仗 | 结构化「已取消」卡片（危险圆标 + 时长 + 可展开过程 + 保留文本 + footer） |
| 转向 | `steerMessage` 走 `abort()` + `session.prompt()`（"先取消再发送"），旧消息误显「已取消」 | 原生 `session.steer()`；steer 消息立即进对话带「转向中」，被转向消息标琥珀「已转向」 |
| 排队 | followUp 消息乐观进对话 + 队列条，与转向视觉混淆（"都是排队"） | 排队驻留输入框上方队列区（序号 + 预览 + 单项取消，可折叠/展开），交付时自动进对话 |
| 计费 | footer 计费 chip 聚合**整会话**（`tasks.find(...).messages`），每个 footer 显示同一总额 | footer 只显**本条 run**；弹层「本条运行」+「会话累计」两区块 |

## 已核实的 SDK 事实（`@earendil-works/pi-coding-agent` 0.83 源码）

- `session.steer(text)`：入 `steeringQueue` 并发 `queue_update`。**不中断在途 LLM 流**；agent-loop 在 **turn 边界**（当前 turn 工具执行完成后、下次 LLM 调用前）以 user 消息注入并流式新 turn → 被转向的在途消息 `message_end` 是 `stopReason:"stop"`（**非 `"aborted"`**）→ 「已转向」检测**不能依赖 stopReason**，由渲染层自持。
- `session.followUp(text)`：入 `followUpQueue`，仅当 agent 无更多工具调用或转向消息后交付。
- `PendingMessageQueue.drain()` 默认 `one-at-a-time`（FIFO，每次交付一条）。
- `queue_update` 在**入队**、**交付**（user `message_start` 触发 agent-session 出队）与 `clearQueue` 时各发一次 → 渲染层可靠感知交付。
- SDK 对 user/assistant 都发 `message_start/end`；主进程 `translateAndEmit` 按 `role === "assistant"` 过滤 → 交付的 user 消息不创建幻影 assistant 消息。
- `session.clearQueue()` 返回并清空 `{ steering, followUp }`（无单项移除 API）。

## 实现要点

### R1 原生 steer + 转向进对话
- 主进程 `agentRuntime.steerMessage`：非空闲 steer 分支由 `abort()`+`prompt()` 改为 `session.steer(fullText)`（空闲仍 `prompt`；followUp 仍 `followUp`）。
- 主进程会话建立时 `session.setSteeringMode("all")`：**多次转向合并**——同一时刻排队的多条转向消息一起注入、合并为一个响应（默认 one-at-a-time 会各自产生一个 turn）。
- 渲染层 `sendMessage(channel="steer")`：乐观加用户消息 + `steerPending`（「转向中」chip）+ 存 `steerReq`；捕获 `steerTargetId`（首次转向时的在途消息，多次转向合并指向同一目标，不在此标记 `redirected`）。
- `useAgentStream` `message_start`：先 `flushPendingFollowUps`；若存在 `steerPending` 用户消息 → 本次 message_start 即该 steer 的响应 turn → `markSteerTargetRedirected`（**标记 `steerTargetId`（首次转向捕获的原始在途消息）为 `redirected` 并清除目标**——当前执行在 turn 边界完成、steer 真正接管时「任务已转向」卡才显示；多次转向合并指向同一目标，后续转向的响应不会被误标）；再 `clearOldestSteerPending`，最后 `startAssistantMessage`。
- `MessageBubble`：用户消息 `steerPending` → 琥珀「转向中」chip；`AssistantGroup` `redirected`（非 cancelled）→ 琥珀「任务已转向」卡（有过程时）或 pill（无过程时）。
- **关键修复**：`sendMessage` 删除 `finally { finalizeMessage }`——原生 steer/followUp 非阻塞立即返回，finally 会提前结算在途消息、丢 usage。

### R2 排队驻队列区
- `sendMessage(channel="followUp")`：**不乐观进对话**，push 到 `pendingFollowUps[taskId]`（带完整附件信息）。
- 交付：`handleQueueUpdate` 用 `diffDeliveredFollowUps`（队列变短量）把已交付的 followUp 从 `pendingFollowUps` 队首插回对话（`buildUserBlocks` 重建用户消息）；`message_start` 时 `flushPendingFollowUps` 兜底（覆盖空闲→prompt 无 queue_update 移除的路径）。
- 队列区 `PendingQueueBar`（新组件）：只渲染 followUp；头部可折叠/展开；每项「排队」chip + `#序号` + 预览 + `✕` 单项取消。
- 单项取消 `cancelFollowUpItem`：置 `clearingQueues` 标志 → `agent:clearQueue`（清空）→ 重发剩余 followUp（带附件）；被清掉的 steer 用对话内 `steerReq` 重发（best-effort）。`clearingQueues` 期间 `handleQueueUpdate` 跳过交付判定，避免误交付被清项。

### R3 结构化「已取消」卡 / 「已转向」卡
- `AssistantGroup`：`canCard = !isStreaming && hasProcess && processBlocks.length > 0`；三态对仗：
  - `redirectCard = redirected && hasProcess && processBlocks.length > 0`（**不依赖 !isStreaming**）→ **「任务已转向」卡**（琥珀圆标 `IconRedirect` + 时长 + [详情/收起] 展开已执行过程 + 下方保留文本）——**转向一发生立即显示**，被转向的组**不再显「任务已完成」**；转向后新 turn 无内容块时卡下方补「运行中」；
  - `cancelCard = canCard && cancelled` → 「已取消」卡（危险圆标 IconStop + 时长 + 过程 + 保留文本）；
  - `cancelled/redirected && !canCard` → 退化红色/琥珀 pill + 平铺（首 block 前兜底）；
  - 正常完成 → 「任务已完成」卡。

### R4 计费：本条 run + 会话累计
- `MessageFooter`：`runRows = aggregateBilling(messages /* 本组 */, models)` → chip 显示本条 run 总额（修复整会话 bug）；`sessionRows = aggregateBilling(整任务 messages, models)`。
- 弹层抽 `BillingRows`：分「本条运行 · N 次模型调用」与「会话累计」两区块，按 llm/vlm/image 分账。
- `billing.ts` 新增 `sumBillingRows`（汇总多行 totalTokens/cost）。取消/转向的 run 经真实 `usage` 自动入账。

## 新增 IPC

`ElectronAPI.agent.clearQueue(streamId): Promise<{ steering: string[]; followUp: string[] }>`（复用 `abortRequestSchema` 校验；`agent:clearQueue` 通道）。

## 关键文件

- `packages/ipc-contract/src/index.ts`（agent.clearQueue）
- `apps/desktop/src/main/runtime/agentRuntime.ts`（steerMessage 原生 steer、clearQueue）
- `apps/desktop/src/main/ipcRouter.ts` + `apps/desktop/src/preload/index.ts`（agent:clearQueue）
- `apps/desktop/src/renderer/stores/sessionStore.ts`（pendingFollowUps / clearingQueues / sendMessage / handleQueueUpdate / cancelFollowUpItem / markStreamRedirected / clearOldestSteerPending / 删除 finally-finalize）
- 新 `apps/desktop/src/renderer/queue.ts`（diffDeliveredFollowUps / buildUserBlocks）、新 `apps/desktop/src/renderer/components/PendingQueueBar.tsx`
- `apps/desktop/src/renderer/hooks/useAgentStream.ts`（message_start 先 flush / queue_update→handleQueueUpdate）
- `apps/desktop/src/renderer/components/MessageBubble.tsx`（转向中 chip / 已转向 pill / 已取消卡）
- `apps/desktop/src/renderer/components/MessageFooter.tsx` + `billing.ts`（本条 run + 会话累计）
- `apps/desktop/src/renderer/components/MainView.tsx`（队列条 → PendingQueueBar）、`SendModeChooser.tsx`（文案）

## 验证

- 门禁：`npm run build` / `npm run test`；`npm run lint` 在改动文件上零新增错误（仓库原有 51 处历史 lint 错误非本次引入，其中 agentRuntime 2 处 useLiteralKeys 为存量）。
- 单测：`tests/billing.test.ts`（sumBillingRows + 本条 vs 会话聚合）、`tests/queue.test.ts`（diffDeliveredFollowUps / buildUserBlocks）。
- 端到端手动（见计划文件 `docs/plans/token-agent-atomic-hamming.md` 验证节）：原生 steer 时序、排队驻留/折叠/单项取消、结构化已取消卡、计费双区块、重启回放。

## 已知限制

- `redirected` / `steerPending` 不持久化：重启后 steered turn 显示为正常完成（JSONL 无 steer 标记）。
- 单项取消经 `clearQueue` 清空再重发：带附件的排队 steer 重发可能丢附件（best-effort，已记录）。
- 原生 steer 不再即时硬停当前输出，而是等当前 turn 边界（按需求，属设计行为）。
