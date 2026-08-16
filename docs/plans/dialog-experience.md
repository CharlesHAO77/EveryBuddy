# EveryBuddy 对话体验增强计划

> 计划文件，确认后按此实施。实现分 8 步（0 为计划落库提交，1-7 为功能实现），每步保持编译 + 测试绿。

## Context

EveryBuddy（Electron + React，agent 由 `@earendil-works/pi-coding-agent` 0.83 驱动）当前对话交互存在明显缺口：取消后仍显示「任务已完成」卡；识图/生图无法立即中断；等待首响应期间界面空白；输入框只有 `/plan`、`@` 提示是文案；AI 消息下方无操作区与模型/token/时间元数据。

本次 7 项改造：①取消语义 ②识图/生图即时取消 ③运行中指示 ④`/steer` `/follow-up` 命令 ⑤AI 消息 footer（复制/赞/踩/转发/分支 + 模型/token/时间）⑥分支新建会话 ⑦`@` 工作区文件识别。

用户决策：steer=打断、follow-up=排队；转发先预留（no-op）；赞/踩仅本地 UI 状态；**token 计费按真实数据开发（JSONL 已有 usage/cost，不做预留），并按模型类型 llm / vlm / image 分别计费**；**agent 运行中用户在输入框输入消息并发送时，提示选择「转向 / 排队」**。

**开工约定**：计划确认后，将本计划写入仓库 `docs/` 并 **git commit 一次**，再开始实现（分步提交实现代码）。

**已验证的 SDK 事实**（`node_modules/@earendil-works/pi-coding-agent` 0.83 源码）：
- `session.abort()` 使在途 assistant 消息 `stopReason="aborted"`；正常 abort 不发 error 事件。`message_end` 在 `appendMessage` 持久化**之前**发出（事件时序：listener 先于落盘）。
- `ToolDefinition.execute(toolCallId, params, signal, ...)` 第 3 参即 `AbortSignal`（来自 agent.run abortController），`ModelRuntime.complete(model, ctx, { signal })` 与 `fetch` 均支持 signal。两个自定义工具当前忽略 signal。
- `steer()/followUp()` 仅**排队**，空闲时不启动 run（agent 循环未运行）→ 空闲必须回退 `session.prompt`。SDK 发 `queue_update` 事件（当前被丢弃）。
- `session.isIdle` getter 存在，主进程可判断空闲。
- 会话 JSONL 条目为 `parentId` 链表；assistant 消息条目已含 `usage`（input/output/cacheRead/cacheWrite/reasoning/totalTokens/cost）与 `provider/model/stopReason`。
- `SessionManager.createBranchedSession(leafId)` 从根到 leafId 生成新会话文件（写**同 sessionDir**，会变更该 manager 的 file 指针 → 必须用临时 `SessionManager.open()` 实例调用；`open()` 构造时 `persist=true`，分支文件会落盘）。
- `historyMapper` 已让回放消息 `id = entry.id`；仅流式新消息是随机 uuid。

## 契约先行（单一真源）

全部改动集中在 `packages/ipc-contract/src/index.ts`，其余消费方同步：

1. 新 `MessageUsage`：`{ input, output, cacheRead, cacheWrite, totalTokens, reasoning?, cost?: { input, output, total } }`。
2. `AgentEvent` 扩展：
   - `message_start` → `payload: { sdkTimestamp: number }`（用 SDK 自身时间戳，避免双进程时钟偏差）。
   - `message_end` → payload 扩展 `{ stopReason?, usage?, model?, provider? }`。
   - 新增 `message_entry_ids`：`payload: { entries: Array<{ sdkTimestamp, entryId }> }`（`agent_settled` 后下发的 assistant 条目 id 映射，分支锚点）。
   - 新增 `queue_update`：`payload: { steering: string[], followUp: string[] }`（排队状态，驱动「已排队」指示）。
3. `HistoryMessage` 加 `usage?/model?/provider?/stopReason?`（回放时「已取消」与 footer 元数据可用）。
4. 新 `BranchRequest` + `branchRequestSchema`：`{ taskId, entryId }`。
5. `ElectronAPI` 加 `agent.steer/agent.followUp(req: PromptRequest)`、`task.branch(req: BranchRequest): Promise<TaskMeta>`。

## 特性①取消 + ③运行中（渲染层为主）

**store**（`apps/desktop/src/renderer/stores/sessionStore.ts`）：
- `ChatMessage` 加 `cancelled?`、`sdkTimestamp?`、`entryId?`；`Task` 加 `pending?: boolean`。
- 新 action：`markMessageCancelled`（置 `cancelled`）、`setMessageMeta`（usage/model/provider）、`markMessageEntryIds`（按 sdkTimestamp 匹配写 entryId）、`setMessageFeedback`。
- `sendMessage` 乐观添加 user 消息后置 `pending: true`（仅 `!isStreaming` 时）；`startAssistantMessage` 收 `sdkTimestamp` 并清 `pending`；`finalizeMessage`/`addErrorMessage` 清 `pending`。
- `hydrateTask`：回放消息统一 `entryId: m.id`。

**事件流**（`apps/desktop/src/renderer/hooks/useAgentStream.ts`）：
- `message_start` 传 sdkTimestamp；`message_end` 若 `stopReason === "aborted"` → `markMessageCancelled`，并 `setMessageMeta`；`message_entry_ids` → `markMessageEntryIds`；`queue_update` → 存 `queuedMessages`。

**主进程**（`apps/desktop/src/main/runtime/agentRuntime.ts`）——补一个关键缺口：abort 发生在工具执行中时，`message_end` 早已发过（stopReason "stop"），不会再收到 "aborted"。实现：`abortRequested` 每任务标志，`abort(taskId)` 置位；收到 `stopReason==="aborted"` 的 message_end 清除；`agent_end` 时若标志仍在 → 合成一条 `message_end { stopReason: "aborted" }` 再清除。渲染层复用同一 handler，两种 abort 路径统一。

**渲染**（`apps/desktop/src/renderer/components/MessageBubble.tsx` `AssistantGroup`）：
- `cancelled = lastMsg.cancelled || lastMsg.stopReason === "aborted"` 且非流式 → 平铺展示所有块（保留部分内容）+ 危险色「已取消」pill，**不渲染**「任务已完成」折叠卡。
- 流式且 `blocks.length === 0` → 渲染 `<RunningIndicator/>`。
- 新组件 `RunningIndicator.tsx`：三颗闪烁圆点（复用 ThinkingCard bounce 模式，`animate-bounce` + 延迟）+「运行中」。

**MainView `ChatView`**：消息列表末尾，`task.pending && !task.isStreaming && messages.length > 0` → `<RunningIndicator/>`（覆盖首 token 前的空白期）。

## 特性②识图/生图即时取消（主进程）

- `tools/understandImageTool.ts`：`execute(..., signal)` → `describeImage(model, image, question, signal)`；`UnderstandImageToolDeps.describeImage` 加 `signal?` 参数。
- `vision.ts`：`describeImage(..., signal?)` → `modelRuntime.complete(model, ctx, { signal })`；`DescribeImageRuntime.complete` 加第三参 `options?: { signal? }`。
- `tools/generateImageTool.ts`：`execute(..., signal)` → `httpGenerateImage(..., { signal })`。
- `imageGeneration.ts`：`FetchLike` init 加 `signal?`；`httpGenerateImage`/`fetchUrlBytes` 把 signal 传给 fetch。
- abort 时 fetch 以 AbortError 拒绝 → 工具返回错误文本 → 结合特性①的合成 abort 呈现「已取消」。`agentRuntime.prompt()` 的「图片附件 + 非视觉模型自动描述」段不在工具内（时段极短），本次不接取消（代码注释说明）。

## 特性④/steer /follow-up

- **主进程**：`agentRuntime` 抽出共享 `buildPromptText(taskId, text, providerId?, attachments?)`（附件暂存 + 视觉自动调度 + manifest，即 `prompt()` 内联段）与 `resolveAndSetModel`；新 `steerMessage(taskId, text, channel, providerId?, attachments?)`：`session.isIdle ? session.prompt(fullText) : (channel==="steer" ? session.steer(fullText) : session.followUp(fullText))`；try/catch → emitError（含 `/steer /plan foo` 扩展命令守卫异常）。
- `ipcRouter` + `preload`：`agent:steer` / `agent:followUp` 通道（`promptRequestSchema` 校验）。
- **渲染**：`slashCommands.ts` 的 `SlashCommand` 加 `insertPrefix?: string`；新增 `/steer`（打断当前生成）、`/follow-up`（排队处理）条目（`insertPrefix: "/steer "` / `"/follow-up "`）；新纯函数 `parseCommandChannel(text)`（`/^\/(steer|follow-up)\s+(.+)$/s`）。
- `useSlashCommands.ts` `selectCommand`：有 `insertPrefix` → 置文本为前缀并保持 textarea 焦点（需 textarea ref）；否则走原 `run(ctx)`。
- **运行中发送提示「转向/排队」**（核心交互）：`ChatView` 中当 `task.isStreaming` 且输入非空时，用户按 Enter/点发送不直接发送，而是在输入框上方弹出一个迷你选择器 `SendModeChooser`：三个选项「转向（打断当前）」「排队（完成后处理）」「取消」。默认高亮「排队」（无侵入）；选中「转向」→ 走 steer 通道，选中「排队」→ 走 followUp 通道。非流式时无选择器、直接发送。ESC 或点外关闭。
- `MainView` `handleSend`（ChatView + WelcomeView）：`parseCommandChannel` 剥离前缀、路由 channel；裸 `/steer`/`/follow-up` → `pushChatNotice` 提示「请输入要发送的内容」，不发送。`sendMessage` 加 `channel?: "steer"|"followUp"` 参数路由到对应 IPC。
- 可选：`queue_update` → 输入框附近「已排队」chip。

## 特性⑤AI 消息 footer

- **数据管道**：`agentRuntime.translateAndEmit` `message_end` 读 `e.message.usage/provider/model` 入 payload；`historyMapper.entriesToHistory` assistant 分支映射 `usage/model/provider/stopReason`。
- 新组件 `apps/desktop/src/renderer/components/MessageFooter.tsx`：左簇模型名（含类型标签）+ token 数（input/output/cacheRead/total）+ 时间；右簇图标：复制（复制末个 text 块）、赞、踩、转发（disabled + 「即将推出」）、分支（调分支流程，流式或 `!entryId` 时 disabled）。赞/踩本地 `feedback` 高亮（不持久化）。
- **真实计费 + 按模型类型分账**：
  - 模型类型解析：providerId → `uiStore.models` 的 `type`（llm/vlm/image），消息级 `provider/model` 优先。
  - 每条 AI 消息 footer 显示：模型名 + 类型标签 + 本条 usage（input/output/cache/total）与 cost（JSONL 已有 `usage.cost`，>0 即展示，无则不显示）。
  - 会话级汇总：新增 selector 聚合当前会话所有 assistant 消息的 usage/cost，**按模型类型分组展示**（对话 LLM / 视觉 VLM / 生图 Image 各自的 token 数 + 费用），渲染为 footer 旁的汇总行或小面板，满足「分别计费」。
- `icons.tsx` 加 `IconThumbsUp`/`IconThumbsDown`/`IconGitBranch`。
- `AssistantGroup` 非流式时渲染 footer；模型名解析优先消息级 `provider/model`，回退 `task.providerId` → `uiStore.models` 查 displayName。

## 特性⑥分支

- **入口 id 管道**：`message_start` 下发 `sdkTimestamp`（SDK 时间戳，免时钟偏差）；`agent_settled` 后 `emitEntryIds(taskId)`：读 `getBranch()` 过滤 assistant 消息条目，发 `message_entry_ids [{ sdkTimestamp, entryId }]`；渲染层按 sdkTimestamp 匹配写 `entryId`。回放消息天然 `entryId = id`。
- 新 IPC `task:branch { taskId, entryId }`：主进程 `branchTask(taskId, entryId)`：
  1. `task = configStore.getTask`；`recentFile = findMostRecentSessionFile(task.sessionDir)`。
  2. 临时 `sdk.SessionManager.open(recentFile, sessionDir, getTaskCwd(task))`。
  3. `newSessionFile = sm.createBranchedSession(entryId)`（entry 缺失抛可读错误）。
  4. 新 `TaskMeta`：新 id；复制 `type/mode/providerId/workspaceId/workspacePath`；`resolveSessionLocation` 取新 sessionDir（temp 取新 workDir）；`title = ${title} · 分支`。
  5. `renameSync(newSessionFile, path.join(newSessionDir, basename))`。
  6. `configStore.addTask` + `createTaskSession(newTask)`。
  7. 返回新任务。
- 渲染：store `branchTask(taskId, entryId)` 调 IPC → 建 Task、`upsertTask`、`selectTask`（hydrate 加载分支历史）。

## 特性⑦@ 文件识别

- 新纯函数 `apps/desktop/src/renderer/fileMentions.ts`：`parseFileMentions(text, files)` — 匹配 `@token`，仅剥离能解析为现有**文件**的 token → `AttachmentRef[]`；未命中的保留字面；按 path 去重。
- 新 hook `apps/desktop/src/renderer/hooks/useFileMentions.ts`：`@` 触发下拉，当前任务 cwd（`task.workspacePath ?? task.workDir`）经 `workspace.readDir` 单层列出 + 目录导航（面包屑），选中插入 `@相对路径 ` 于光标处（需 textarea ref）。
- `MainView` 组合：textarea 加 ref；`onKeyDown` 若 mention 菜单开 → mention 处理（Enter 选中文件 preventDefault，不发送），否则委派 `slash.handleKeyDown`；`handleSend` 用 `parseFileMentions` 剥离出附件与 cleanText → `sendMessage(taskId, cleanText, 合并附件, channel)`。
- `WorkspaceDirEntry` 已含 `name/path/isDir/size`，足够构造 `AttachmentRef`（mimeType 留空，`stageAttachments` 按文件名派生类型）。

## 实现顺序（依赖驱动，每步保持编译 + 测试绿）

0. **计划落库并提交**：将本计划写入仓库 `docs/plans/dialog-experience.md`，`git add` + `git commit`（提交信息如 `docs: 对话体验增强实施计划`）。
1. 契约（ipc-contract 全部类型/schema/ElectronAPI + 其测试）。
2. 特性③+①（sessionStore/useAgentStream/MessageBubble/MainView/RunningIndicator；含 sdkTimestamp 与 message_end 元数据管道）。
3. 特性②（主进程 vision/imageGeneration/tools + agentRuntime 工具依赖接线）。
4. 特性⑤（agentRuntime message_end 元数据、historyMapper、MessageFooter 真实计费 + 按类型汇总、store meta/feedback）。
5. 特性⑥（agentRuntime branchTask + emitEntryIds + 合成 abort；preload/ipcRouter；store markMessageEntryIds/branchTask）。
6. 特性④（preload/ipcRouter/agentRuntime steerMessage；slashCommands/useSlashCommands；MainView 路由 + `SendModeChooser` 运行中提示转向/排队）。
7. 特性⑦（fileMentions/useFileMentions/MainView 组合）——最后做，与④争同一 textarea 输入面。

## 关键文件

- `packages/ipc-contract/src/index.ts`（契约）
- `apps/desktop/src/main/runtime/agentRuntime.ts`（steerMessage / branchTask / emitEntryIds / 合成 abort / message_end 元数据）
- `apps/desktop/src/main/ipcRouter.ts` + `apps/desktop/src/preload/index.ts`（新通道）
- `apps/desktop/src/main/services/vision.ts` / `imageGeneration.ts` / `tools/understandImageTool.ts` / `tools/generateImageTool.ts`（signal）
- `apps/desktop/src/main/services/historyMapper.ts`（usage/model/provider/stopReason 映射）
- `apps/desktop/src/renderer/stores/sessionStore.ts`（cancelled/pending/sdkTimestamp/entryId/meta/feedback/channel）
- `apps/desktop/src/renderer/hooks/useAgentStream.ts` / `useSlashCommands.ts`
- `apps/desktop/src/renderer/components/MessageBubble.tsx`（AssistantGroup 已取消/运行中/footer）、新 `MessageFooter.tsx`、`RunningIndicator.tsx`、`MainView.tsx`
- `apps/desktop/src/renderer/slashCommands.ts`（/steer /follow-up + parseCommandChannel）
- 新 `apps/desktop/src/renderer/fileMentions.ts` / `hooks/useFileMentions.ts`

## 验证

- 门禁：`npm run build`（全 workspace 类型检查）、`npm run lint`（biome）、`npm run test`（vitest）。
- 单测候选：`tests/slashCommands.test.ts`（parseCommandChannel）、`tests/historyMapper.test.ts`（usage/model/stopReason 映射）、`tests/vision.test.ts` / `tests/imageGeneration.test.ts` / `tests/understandImageTool.test.ts` / `tests/generateImageTool.test.ts`（aborted signal 即时 reject）、新 `tests/fileMentions.test.ts`、store 的 pending/cancelled/entryId 状态转换。
- 端到端手动：
  1. 发送 → 首响应前见「运行中」三圆点；点停止 → 部分内容 + 「已取消」，无「任务已完成」卡；重启后回放仍「已取消」。
  2. 识图/生图运行中点停止 → 立即中断（不再等待图片返回）。
  3. 运行中输入 `/steer 换个思路` → 立即打断并处理；`/follow-up x` → 排队；空闲时 `/steer x` 等同普通发送；裸 `/steer` 提示不发送。
  3b. 运行中直接在输入框打字 + 回车 → 弹出「转向 / 排队 / 取消」选择器，选转向立即打断、选排队排队处理；空闲时回车直接发送。
  4. AI 消息下 footer：复制/赞/踩/分支可用、转发置灰；模型名 + 类型标签 + 本条 token/cost 展示；footer 汇总行按 llm/vlm/image 分组显示各自 token 与费用；分支后侧栏新增会话、历史止于该消息、可续聊、重启仍在。
  5. 输入 `@` → 弹工作区文件列表、可进子目录、选中插入；发送后附件 chip 出现、agent 可读文件；`@不存在` 走字面文本。
