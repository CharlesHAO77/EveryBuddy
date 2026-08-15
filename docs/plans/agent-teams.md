# 专家团 Agent Teams —— subagent-as-tools + Agent Workflow 编排

## Context（为什么做）

EveryBuddy 的 README roadmap 明确把 **Expert teams — multi-agent dispatch and workflow orchestration** 列为下一阶段；`docs/plans/expert-skill-connector.md` §2.2 预留了两条能力线，schema 字段（`routingStrategy: auto/workflow`、`sharedTools`、`sharedExtensions`）已落 `ipc-contract`，**零迁移**。

现状盘点（已核实）：

- `Expert` / `ExpertTeam` 实体、`team:*` CRUD（`teamStore.ts`）、`teams.json`、团队管理 UI 已存在，但**运行时零消费**：`agentRuntime.ts` 只读 `task.expertId`，`PlusMenu` 选团队时只是取首位成员。
- **顺带发现缺口**：`ipcRouter.ts` 的 `task:create`（195-207）当前**未把 `req.expertId` 写入 TaskMeta**——欢迎页选自定义专家只影响 `mode`，persona 覆盖未生效。本轮一并修复。
- 技术底座就绪：agent 由 `@earendil-works/pi-coding-agent` SDK 驱动，一次 task = 一个 `AgentSession`；SDK 支持 `createAgentSession` + `SessionManager.inMemory()` 建**隔离的临时子会话**。

**已验证的 SDK 事实**（pi-coding-agent 0.83 / pi-agent-core 源码）：
1. 一个 turn 内多个工具调用**默认并行执行**（`executeToolCallsParallel`，`agent-loop.js:287-293`）——pi-subagents 的 fan-out 语义天然成立。
2. 工具签名 `execute(toolCallId, args, signal, onUpdate, ctx)`：`signal` 是当次 run 的 AbortSignal（父 `session.abort()` 会触发在途 delegate 的 signal）；`onUpdate(partialResult)` 经父会话发 `tool_execution_update`——子文本可**零渲染改动**流进父工具块。
3. `session.prompt()` 在 run 结束后 resolve；`session.dispose()` 清理监听；`AgentToolResult = { content: Text|ImageContent[], details, usage? }`。
4. **子 `message_update.text_end.content` 是累计全文**（非增量）——最终文本取 `text_end.content`，不要与 `text_delta` 累加重复。
5. `scheduler.ts` 的 `execute()`（379-495）是「无头跑一个 AgentSession、收集 text/usage、settle」的现成范式；`addUsage` 可复用。
6. `buildExtensionFactories` 当前**无条件注入 permission**——headless 子会话需加 `includePermission` 开关。

目标：激活预留的 `routingStrategy: "auto"`（子 Agent 调度 / subagent-as-tools）与 `"workflow"`（代码定义的确定性流程编排），对话区可视化子 Agent 与流程执行。

## 用户已确认的决策

1. **两条能力线本轮都做**：auto 调度 + workflow 编排。
2. **workflow 先通过代码定义流程，只做可视化结果展示，不做可视化编辑**（不建 DAG 画布/编辑器）。
3. **子 Agent 运行过程以「父工具卡内嵌面板」展示**（类 pi 折叠卡片）。

---

## 一、契约先行（packages/ipc-contract/src/index.ts，单一真源）

### 1.1 TaskMeta / CreateTaskRequest 增加 `teamId`
- `TaskMeta.teamId?: string`；`CreateTaskRequest.teamId?: string`（与 `expertId` 互斥，选中团队时设置）。
- `createTaskRequestSchema` 加 `teamId: z.string().optional()`。
- **修复既有缺口**：`task:create` 构造 TaskMeta 时同时透传 `req.expertId` 与 `req.teamId`（`branchTask` 分支新任务继承 `teamId`/`expertId`）。渲染层 `sessionStore.createTask/branchTask` 拼 `Task` 时带上两字段。

### 1.2 ExpertTeam 增加 `workflow` + 新类型 `TeamWorkflow`/`WorkflowStep`
```ts
/** 工作流单步引用（串行单专家 / 并行组内成员） */
export interface WorkflowStepRef { id: string; expertId: string; prompt: string }
/** 步骤：串行单专家，或并行专家组（同依赖并发） */
export type WorkflowStep =
  | ({ kind: "serial" } & WorkflowStepRef)
  | { kind: "parallel"; id: string; steps: WorkflowStepRef[] };

/** 代码定义的工作流（本轮无可视化编辑器，由代码/种子构造，UI 只读展示） */
export interface TeamWorkflow {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  /** 最终汇总专家（缺省 team.expertIds 末位） */
  summarizerExpertId?: string;
}
// ExpertTeam 加: workflow?: TeamWorkflow
// CreateTeamRequest / UpdateTeamRequest 加: workflow?: TeamWorkflow | null（null 清除）

/** 团队来源：builtin 内置示例（代码内 const）/ custom 自定义（teams.json）——对齐 Expert.source */
export type TeamSource = "builtin" | "custom";
// ExpertTeam 加: source: TeamSource；teamStore.load() 对旧条目缺省 "custom"（零迁移）
```
> 提示词模板支持两个占位，运行时替换：`{user}` = 用户触发消息；`{{stepId.result}}` = 引用指定前步输出（如 `{{analysis.result}}`）。

### 1.3 AgentEvent 新增子 Agent / workflow 事件（全部 `streamId = 父 taskId`）
```ts
// —— 子 Agent（auto 调度的 delegate 与 workflow 步骤共用）——
| { streamId: string; type: "subagent_start";
    payload: { subagentId: string; parentToolCallId: string; expertId: string; expertName: string;
               prompt: string; stepId?: string } }
| { streamId: string; type: "subagent_delta";
    payload: { subagentId: string; parentToolCallId: string; delta: string; stepId?: string } }
| { streamId: string; type: "subagent_tool";
    payload: { subagentId: string; parentToolCallId: string; stepId?: string; toolName: string;
               toolCallId: string; args?: unknown; phase: "start" | "update" | "end";
               ok?: boolean; output?: unknown; error?: string } }
| { streamId: string; type: "subagent_end";
    payload: { subagentId: string; parentToolCallId: string; stepId?: string;
               status: "ok" | "error" | "aborted"; text?: string; error?: string; usage?: MessageUsage } }

// —— workflow 骨架（只发结构，内容走 subagent_*）——
| { streamId: string; type: "workflow_start"; payload: { workflowId: string; name: string; stepCount: number } }
| { streamId: string; type: "workflow_step_start";
    payload: { stepId: string; expertIds: string[]; prompt: string; kind: "serial" | "parallel" } }
| { streamId: string; type: "workflow_step_end";
    payload: { stepId: string; ok: boolean; output?: string; error?: string; usage?: MessageUsage } }
| { streamId: string; type: "workflow_end";
    payload: { status: "ok" | "error" | "aborted"; summary?: string; error?: string; usage?: MessageUsage } }
```
- `subagent_start.parentToolCallId`：渲染层经 `findToolBlock(parentToolCallId)` 把子面板挂到父 `delegate` 工具块；`stepId` 让 workflow 步骤与子 agent 绑定（`workflow_step_start` 也会发 `subagentId` 关联，见 §2.4）。
- `AgentEvent` 是**加性联合**，无 Zod schema（事件只主→渲染，沿用现状）。

### 1.4 ElectronAPI / preload
- `agent` 增：`runWorkflow: (req: RunWorkflowRequest) => Promise<void>`；`RunWorkflowRequest { taskId, teamId, prompt, providerId? }` + `runWorkflowRequestSchema`。
- 事件流**不新增通道**：`subagent_*`/`workflow_*` 经现有 `agent:event` 广播。

---

## 二、运行时（apps/desktop/src/main/）

### 2.1 重构：抽出共享会话构建器 `sessionBuilder.ts`
把 `agentRuntime.createTaskSession`（180-367）从「模型解析」到 `createAgentSession` 之间的逻辑抽为自由函数 `buildSessionConfig(opts)`，**会话 manager 无关**（调用方提供：任务用持久化 manager，子 agent 用 `inMemory()`），任务路径行为逐字节不变。

```ts
// sessionBuilder.ts —— 共享会话构建（createTaskSession 与子代理 spawner 共用）
interface BuildSessionConfigOptions {
  sdk; modelRuntime; availability; cwd; mode: AgentMode;
  expert?: Expert;                 // 已解析专家（叠加覆盖后）
  providerId?: string;             // 模型优先级：explicit → cfg.defaultModelProviderId → 首个可对话模型
  emit: (evt: WithoutStreamId<AgentEvent>) => void;
  getMode: () => ExecutionMode;
  resolveModel: (providerId: string) => PiModel | undefined;
  extraTools?: ToolDefinition[];   // delegate 工具注入点
  extraToolNames?: string[];
  headless?: boolean;              // 子会话：跳过 permission + 默认扩展（plan-mode/todo）
  extensions?: string[];
}
interface SessionBuildResult { model; cfg; plan; customTools; toolAllowlist; systemPrompt;
  resourceLoader; controllers; factories }
```

移动内容（原样语义）：`getAgentConfig(mode)` + `expertToAgentConfig`、模型解析、视觉/生图 provider 闭包、`buildToolPlan` + customTools 装配（parse_attachment / Git Bash / node grep/find / understand_image / generate_image / MCP 工具）、`buildExtensionFactories`、`buildToolAllowlist`（并入 `extraToolNames`）、`systemPrompt`、skills `skillsOverride` + `DefaultResourceLoader` + `reload()`。

**`extensions/index.ts` 小改**：`buildExtensionFactories(names, emit, deps, opts?: { includePermission?: boolean })`，headless 传 `includePermission: false`（默认仍恒注入，向后兼容）。

`createTaskSession` 改为：解析 expert → （auto 团队时 `teamRuntime.buildDelegateTools` 注入 extraTools）→ `buildSessionConfig` → `createAgentSession` → 订阅/登记。**非团队任务 extraTools 为空，零行为变化**。

**依赖环处理**：`agentRuntime` value-import `teamRuntime`；`teamRuntime` 只 `import type` agentRuntime，能力经 `wire(deps)` 注入（scheduler 同款 DI）。模块求值序：`app.ts → agentRuntime → teamRuntime(wire) → agentRuntime.getTeamDeps()`，无环。

### 2.2 新模块 `teamRuntime.ts` —— `TeamRuntime`
```ts
class TeamRuntime {
  private active = new Map<subagentId, ActiveSubagent>();   // { session, dispose, parentTaskId, aborter }
  private running = 0;  private static readonly MAX_CONCURRENT = 4;
  private static readonly SUBAGENT_MAX_MS = 10 * 60 * 1000;

  wire(deps: TeamRuntimeDeps): void;
  setSessionFactory(f: SubagentSessionFactory): void;        // 测试注入

  /** 代码生成默认 workflow（成员序：首=分析/规划，中段=执行，末=汇总评审；串行链，各步注入上一步结果） */
  buildDefaultWorkflow(team: ExpertTeam, members: Expert[]): TeamWorkflow;
  /** 生成 coordinator 系统提示（auto 团队）：团队用途 + 成员名册 */
  buildCoordinatorPrompt(team: ExpertTeam, members: Expert[]): string;

  /** auto：构造 delegate 工具（单工具 + expert 枚举参数；description 内嵌成员名册） */
  buildDelegateTools(team: ExpertTeam, ctx): Promise<ToolDefinition[]>;
  /** 子 agent 引擎（delegate 与 workflow 共用）：建临时子会话、prompt、流 subagent_*、返回结果 */
  runSubagent(opts): Promise<SubagentResult>;
  /** workflow 引擎：拓扑推进步骤 → 汇总；流 workflow_* + subagent_* */
  runWorkflow(taskId, teamId, prompt, providerId?): Promise<void>;
  /** 中止/清理：agentRuntime.abort / disposeSession 级联调用 */
  abortForTask(taskId): void;   disposeForTask(taskId): void;
}
```

**`runSubagent`**（核心，delegate + workflow 共用）：
1. 深度守卫（子会话无 delegate 工具 → 天然 depth=1）+ 并发信号量（>4 排队）。
2. `subagentId = randomUUID()`；发 `subagent_start`。
3. 经 `sessionFactory`（真实实现 = `buildSessionConfig({ headless: true, getMode: () => "auto", ... })` + `SessionManager.inMemory(cwd)` + `createAgentSession` + 订阅 `translateSubagentEvent`）建子会话。
4. 注册 `active`；`signal?.addEventListener("abort", abortChild)` + watchdog。
5. `await child.session.prompt(prompt)`；订阅器累计 `lastText`（`text_end.content` 为准）+ `usage`（复用 scheduler 的 `addUsage`）。
6. settle → `subagent_end`；finally `child.dispose()`、注销、放行信号量。
7. 返回 `{ subagentId, text, usage, status: "ok"|"error"|"aborted", error? }`。**子报错/中止一律返回不 throw**，父 turn 继续。

**`delegate` 工具 execute**：调 `runSubagent`；结果 `{ content: [{ type: "text", text }], details: { subagentId, usage } }`；失败返回 `[子代理 … 执行失败] …` 文本。子 delta 同时经 `onUpdate` 喂父 `tool_execution_update`（渲染层零改动可见流式）。

**`runWorkflow`**：
- 取 `team.workflow ?? buildDefaultWorkflow(team)`；发 `workflow_start`。
- 按步骤拓扑执行：serial → 1 个子 agent；parallel → `Promise.all` 并发（各带独立 subagentId、共享 stepId）。`{{stepId.result}}` 模板替换后入子 prompt。
- 步骤输出累计 `results`、聚合 `usage`；发 `workflow_step_start/end`。
- 最后汇总子 agent（`summarizerExpertId ?? 末位成员`）产出 `workflow_end`（summary + 总 usage）。任一步失败不中断管道（标记 ok:false 继续）；workflow 级 `AbortController` 级联中止在途步骤。

**子会话事件归一化 `translateSubagentEvent`**（子 SDK 事件 → `subagent_*`）：
| 子事件 | 发出 |
|---|---|
| `message_update.text_delta` | `subagent_delta` + `onUpdate`（双路径） |
| `message_update.text_end` | 最终文本以 `text_end.content` 为准 |
| `tool_execution_start/update/end` | `subagent_tool { phase }` |
| `message_end`(assistant) | 累计 usage |
| `error` / settle | `subagent_end { status }` |
> **关键**：绝不复用 `agentRuntime.translateAndEmit`（会把子文本当成父 assistant 消息注入）。

### 2.3 接线（agentRuntime.ts + ipcRouter.ts）
- `agentRuntime`：
  - 加 `getTeamDeps()`（emitTo / loadSdk / ensureModelRuntime / getModelRuntime / getAvailability / resolveModel / getTaskCwd / getTask）与 `emitTo(streamId, evt)` 公开委托。
  - `createTaskSession`：`task.teamId` → auto 团队 → `buildDelegateTools` 注入；**workflow 团队 → 提前返回（不建 AgentSession）**。
  - `prompt/steer/followUp/clearQueue`：workflow 团队任务 → emit 明确错误（"该任务绑定工作流团队，请运行工作流"），不走 session。
  - `abort(taskId)` / `disposeSession(taskId)`：追加调用 `teamRuntime.abortForTask/disposeForTask`。
- `ipcRouter.ts`：注册 `agent:run-workflow`（校验 → `teamRuntime.runWorkflow`）；`task:create` 透传 `expertId`/`teamId`；`branchTask` 继承。
- `app.ts`：`teamRuntime.wire(agentRuntime.getTeamDeps())`（与 scheduler.wire 同生命周期）。

### 2.4 内置示例团队（开箱即用）
`teamStore.ts` 增加 `BUILTIN_TEAMS: ExpertTeam[]`（代码内 const，不落盘，对齐 `BUILTIN_EXPERTS` 模式），`list()`/`get()` 合并返回；成员**复用现有内置专家**（`daily` 办公助理 + `coding` 编码助手，恒存在），无需新建示例专家。内置团队 UI 上只读 + 「复制为自定义」（对齐内置专家）。

**示例① subagent-as-tools（auto）——「团队调度演示」**
```ts
{ id: "team-example-dispatcher", name: "团队调度演示", icon: "bot",
  description: "主 Agent 自动分派子任务给办公/编码两位专家，并行协作后汇总",
  expertIds: ["daily", "coding"], routingStrategy: "auto", source: "builtin", ... }
```
体验路径：欢迎页选该团队 → 发一句跨领域任务（如"帮我把这个 Excel 整理成报告，并给出实现建议"）→ coordinator 思考后用 `delegate` 工具并行调办公助理（文档/表格）+ 编码助手（方案/实现），子面板流式显示两个子 agent 产出，最后汇总。

**示例② workflow 编排（workflow）——「需求 → 设计 → 编码 → 评审」**
```ts
{ id: "team-example-workflow", name: "开发流程演示", icon: "workflow",
  description: "需求分析 → 方案设计 → 编码实现 → 质量评审 的确定性流水线",
  expertIds: ["daily", "coding"], routingStrategy: "workflow", source: "builtin",
  workflow: {
    id: "wf-example-dev", name: "需求 → 设计 → 编码 → 评审",
    steps: [
      { kind: "serial", id: "analysis",   expertId: "daily",  prompt: "你是需求分析师：针对「{user}」，澄清并输出需求要点与验收标准。" },
      { kind: "serial", id: "design",     expertId: "coding", prompt: "你是方案设计师：基于上一步结论 {{analysis.result}}，输出技术方案与任务拆解。" },
      { kind: "serial", id: "implement",  expertId: "coding", prompt: "你是编码专家：按方案 {{design.result}} 实现，产出代码与改动说明（直接在工作区落地）。" },
      { kind: "serial", id: "review",     expertId: "daily",  prompt: "你是质量评审：审查 {{implement.result}}，给出问题清单与改进建议。" },
    ],
    summarizerExpertId: "daily",
  } }
```
体验路径：欢迎页选该团队 → 发一句需求（如"写一个 TODO 命令行小工具"）→ `WorkflowRunCard` 分步推进：分析 → 设计 → 编码 → 评审 → 汇总文本。

> 用户自建的 workflow 团队若未配 `workflow`，`runWorkflow` 回退 `buildDefaultWorkflow(team)`（成员序：首=分析，中段=执行，末=汇总评审）。内置示例直接给出完整字面量，兼顾展示效果与稳定性。

---

## 三、渲染层 UI

### 3.1 欢迎页团队选择（MainView + PlusMenu）
- `WelcomeView` 加 `teamId` 状态；`PlusMenu.handleSelectTeam` 按 `t.routingStrategy` 分流：
  - `manual` → 现状（取首位成员为助手）；
  - `auto` / `workflow` → `onSelectTeam(t)` 记 teamId，chip 显示团队名（`IconUsers`），`createTask({ teamId })`（不传 expertId）；`mode` 取团队首成员的 mode。
- 欢迎页发送逻辑：任务创建后，若该任务绑定了 **workflow** 团队 → 首条消息走 `agent.runWorkflow({ taskId, teamId, text })` 而非 `agent.prompt`（`sendMessage` 内分支）。

### 3.2 团队详情（DetailModal TeamForm）
- `routingStrategy` 选择器（manual/auto/workflow 均可选；去掉「仅 manual」灰态说明与「预留」warn）。
- **内置团队只读**：名称/图标/成员/策略/流程不可改（对齐内置专家），提供「复制为自定义」生成一份 custom 团队（含 workflow 字面量）后可编辑。
- 选 `workflow` 时展示 `team.workflow` **只读流程卡片**（步骤链 + 每步执行专家 + 汇总），注明「流程由代码生成，仅展示」。
- 团队卡片（ExpertView + PlusMenu）显示「内置/自定义」来源徽章（对齐专家 SourceBadge）。
- 删除/替换 `ReservedModal` 与专家团 tab 的两张预留占位卡。

### 3.3 对话区：子 Agent 面板（父工具卡内嵌，类 pi）
- `sessionStore` 增 `subAgents: Record<taskId, Record<subagentId, SubAgentState>>`：
  ```ts
  interface SubAgentState {
    subagentId: string; parentToolCallId: string; expertId: string; expertName: string;
    prompt: string; stepId?: string; status: "running" | "ok" | "error" | "aborted";
    delta: string; tools: Array<{ toolName: string; toolCallId: string; phase: string; output?: unknown }>;
    text?: string; usage?: MessageUsage;
  }
  ```
- `useAgentStream` 加 `subagent_*` 分支 → 写入 store（`subagent_start` 用 `findToolBlock(taskId, parentToolCallId)` 挂到父 delegate 工具块，见 sessionStore.ts:248-256）。
- 新组件 `SubAgentPanel.tsx`：内嵌于 `ToolCallCard`（当 `block.toolName === "delegate"` 且 store 有对应子状态时，展开区追加面板）：专家头像+名 + 运行 spinner + 可折叠流式文本/子工具列表 + 结束结果 + token 用量。子文本经 `tool_execution_update` 的冗余流也在「输出」节可见。

### 3.4 对话区：Workflow 运行卡
- `sessionStore` 增 `workflowRuns: Record<taskId, WorkflowRunState>`（`workflow_*` + `subagent_*` 驱动，`stepId↔subagentId` 绑定）。
- 新组件 `WorkflowRunCard.tsx`：用户消息下方渲染——横向步骤链（每步：专家名 + 状态圆点），点步骤展开该步骤的 SubAgentPanel；底部汇总文本 + 总 usage。
- 持久化：MVP 运行态为内存态（reload 后消失）；后续补 run-history 落盘（§5 后续项）。

---

## 四、测试与验证

- **单测**（`apps/desktop/tests/`，vitest，独立目录；需加入 desktop tsconfig include）：
  - `sessionBuilder.test.ts`：stub sdk/modelRuntime——(a) 非团队路径配置与重构前逐项等价；(b) `extraTools`/`extraToolNames` 并入 customTools + allowlist；(c) `headless:true` 跳过 permission + 默认扩展；(d) 模型回退优先级。
  - `teamRuntime.test.ts`：注入 `TeamRuntimeDeps` fake + fake SessionFactory（发合成 `message_update/text_delta/text_end`、`tool_execution_*`、`message_end(usage)`、resolve prompt）——断言 `subagent_start/delta/end` 时序与最终 text/usage；父 signal abort 级联；并发上限排队；子 throw → `subagent_end status:"error"` 且 delegate 不抛。
  - `workflowEngine.test.ts`：fake 子 runner——serial/parallel 顺序、`{{stepId.result}}` 模板替换、`workflow_start/step_start/step_end/end` 时序、汇总步骤、错误路径。
  - `ipcContract.test.ts`：`teamWorkflowSchema`/`workflowStepSchema` 合法/非法、`createTaskRequestSchema` 收 `teamId`、`runWorkflowRequestSchema`、`subagent_*`/`workflow_*` 可赋值 `AgentEvent` 的穷尽性冒烟。
  - `teamStore.test.ts`（扩展）：`list()`/`get()` 合并内置 + 自定义；内置团队不落盘、旧 teams.json 条目 `source` 缺省 "custom"；「复制为自定义」生成含 workflow 字面量的 custom 团队。
- **typecheck**：`npm run typecheck`（全 workspace，契约变更门禁）。
- **手工 E2E**（`npm run dev`，用内置示例团队）：
  1. 选内置「团队调度演示」（auto）→ 发跨领域任务 → coordinator 用 `delegate` 并行调办公/编码两位专家，子面板流式显示两个子 agent 产出并汇总。
  2. 选内置「开发流程演示」（workflow）→ 发需求（如"写一个 TODO 命令行小工具"）→ WorkflowRunCard 分步推进：分析 → 设计 → 编码 → 评审 → 汇总。
  3. 子 agent 运行中点取消 → 子会话中止、卡片标「已取消」。
  4. 内置团队只读 + 「复制为自定义」可用；自定义团队仍可自由编辑。
  5. 回归：普通任务（无团队）行为不变；自定义专家选择真正生效（顺带修复项）。

---

## 五、分步实施顺序（每步保持编译+测试绿）

1. **契约 + 内置示例**：ipc-contract 全部类型/schema/ElectronAPI（§1）+ `task:create` 修 expertId + 带 teamId + **`TeamSource` + `BUILTIN_TEAMS`（两个内置示例团队，含 workflow 字面量）+ `teamStore.list()/get()` 合并 + 复制为自定义**。
2. **重构**：抽 `sessionBuilder.ts` + `buildExtensionFactories` includePermission；`createTaskSession` 改用它（零行为变化）。
3. **运行时**：`teamRuntime.ts`（buildDefaultWorkflow / buildCoordinatorPrompt / buildDelegateTools / runSubagent / runWorkflow / translateSubagentEvent / abort·dispose 级联）+ agentRuntime 接线 + `agent:run-workflow` 通道 + app.ts wire。
4. **渲染层状态**：sessionStore `subAgents`/`workflowRuns` + useAgentStream 新事件分支 + `findToolBlock` 挂载。
5. **UI**：PlusMenu/WelcomeView 团队选择与首消息分流、TeamForm 策略选择+workflow 只读展示+内置团队只读/复制、来源徽章、SubAgentPanel、WorkflowRunCard、清理预留占位卡。
6. **测试 + 收尾**：单测（含内置示例）、typecheck、lint、手工 E2E（用两个内置示例走通）。

## 后续项（本轮不做）
- workflow 可视化编辑器 / 可持久化 workflow 定义（UI 编辑）。
- workflow run-history 落盘（reload 恢复）。
- 定时自动化（scheduler）绑定团队。
- 子 agent 会话 JSONL 持久化 / 分支查看。
- workflow 任务运行后的后续对话（本轮绑定 workflow 的任务只跑一次，后续消息提示「请新建任务」）。

## 关键文件清单
| 改动 | 路径 |
|---|---|
| 契约（类型/schema/ElectronAPI） | `packages/ipc-contract/src/index.ts` |
| 共享会话构建器（新） | `apps/desktop/src/main/sessionBuilder.ts` |
| 团队运行时（新） | `apps/desktop/src/main/teamRuntime.ts` |
| 运行时接线（auto/workflow 分流、delegate 注入、abort 级联） | `apps/desktop/src/main/agentRuntime.ts` |
| 扩展工厂开关 | `apps/desktop/src/main/extensions/index.ts` |
| IPC 路由 + preload + app 接线 | `apps/desktop/src/main/ipcRouter.ts` · `src/preload/index.ts` · `src/main/app.ts` |
| 团队 store（workflow 字段持久化 + BUILTIN_TEAMS 内置示例 + 复制为自定义） | `apps/desktop/src/main/teamStore.ts` |
| 渲染层状态 + 事件流 | `apps/desktop/src/renderer/stores/sessionStore.ts` · `hooks/useAgentStream.ts` |
| 欢迎页/菜单团队选择 + 首消息分流 | `apps/desktop/src/renderer/components/MainView.tsx` · `expert/PlusMenu.tsx` |
| 团队详情（策略选择 + workflow 只读展示） | `apps/desktop/src/renderer/components/expert/DetailModal.tsx` · `ExpertView.tsx` |
| 子 Agent 面板 + workflow 卡（新） | `apps/desktop/src/renderer/components/SubAgentPanel.tsx` · `WorkflowRunCard.tsx` · `ToolCallCard.tsx` |
