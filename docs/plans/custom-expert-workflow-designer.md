# 自定义专家按配置运行 + Workflow 画布设计器（React Flow）

> 存档：2026-08-16 · 画布观感已通过 → 上 @xyflow/react。预览：`workflow-designer-canvas-preview.html`（画布效果图）、`workflow-designer-preview.html`（列表 v2）。

## Context

用户反馈两个问题：

1. **自定义专家跑成了"办公助理"**。路由本身没丢——`expertId` 从欢迎页输入框一路写入 `TaskMeta` 并在 [agentRuntime.ts:208](apps/desktop/src/main/runtime/agentRuntime.ts#L208) 解析。真正原因是双重的：
   - 新建弹窗 [CreateModal.tsx:107](apps/desktop/src/renderer/components/expert/CreateModal.tsx#L107) 只存 `{ name, description, mode }`，创建时无法绑定系统提示词/工具/扩展（绑定 UI 只存在于编辑弹窗 `ExpertForm`）。
   - [expertStore.ts:74-84](apps/desktop/src/main/stores/expertStore.ts#L74-L84) `expertToAgentConfig` 仅在字段非空时叠加——空配置专家回落到模式基础配置，`mode:"daily"` 恰好就是"办公助理"。

   用户决定：① 创建弹窗补上绑定字段；② 自定义专家未写系统提示词时，自动按"名称+描述"生成一条身份提示词，让它立刻有独立人格而非静默变成办公助理。

2. **workflow 需要真正可设计，且以画布形态呈现**。引擎已存在（专家团 `routingStrategy:"workflow"`，[teamRuntime.ts:417](apps/desktop/src/main/runtime/teamRuntime.ts#L417) `runWorkflow`，串行/并行、`{{stepId.result}}` 模板、末尾汇总），但无 UI 编辑入口、并行无测试。经多轮设计评审，用户最终确定：**专家配置留在专家中心改，设计器只编排流程、引用系统专家**；UI 用**画布形式（React Flow：可拖动节点、连线可视化、缩放、minimap、右侧编辑面板）**；节点类型支持 **任务（串行）/ 并行 / 条件（if/else）**；条件用**确定性规则**（对齐 Dify/Coze/n8n 主流，避免把引擎做重）。

**已确认的设计取舍**：
- 条件节点 = 结构化确定性规则（`{{stepId.result}} 包含/为空/长度>n`…，与/或组合），本地字符串求值，零 token、可单测。不做 LLM 路由。
- 节点词汇表 = 任务（串行）/ 并行 / 条件（then/else 嵌套子链）/ 汇总（隐式收尾，沿用现有 summarizerExpertId）。
- 画布为**结构化画布**：结构由嵌套模型决定（执行序 = 数组序），拖动只改视觉位置，连线自动生成——永远与引擎语义一致，不引入通用 DAG（免去汇合/拓扑/环检测）。循环/switch 缓做。
- 画布观感已通过（见预览），上 `@xyflow/react` 实现。

**技术事实（已核实）**：IPC 契约与 Zod schema 除 conditional 新类型外无需大改——`CreateExpertRequest` 已含 `systemPrompt/tools/extensions`（index.ts:580-593），`CreateTeamRequest`/`UpdateTeamRequest` 已含 `workflow`（index.ts:769,787）；`expertCenterStore.createTeam/updateTeam` 原样透传。i18n 完整性测试（tests/i18n.test.ts）要求 zh-CN/en 两文件 key 集合一致。

---

## Feature 1 — 自定义专家身份提示词

### 1.1 新建 `apps/desktop/src/main/services/expertPrompt.ts`

确定性、中文的身份提示词生成器（数据内容保持中文）：

```ts
export function buildExpertIdentityPrompt(name: string, description?: string): string {
  const desc = description?.trim();
  const descLine = desc ? `你的定位：${desc}。` : "";
  return `你是「${name}」。${descLine}
你以这一身份独立完成任务，始终保持专业、准确、高效，主动推进目标。
请用中文回复用户，输出保持简洁、条理清晰；给出结论与可执行的下一步。
`;
}
```

### 1.2 `expertStore.create`（expertStore.ts:162-186）

`systemPrompt` 空白 → 用 `buildExpertIdentityPrompt(name, description)` 填充；显式填写则保留。

### 1.3 `expertStore.update`（expertStore.ts:188-225，仅 custom 分支）

`stillAuto = !existing.systemPrompt || existing.systemPrompt === buildExpertIdentityPrompt(existing.name, existing.description ?? "")`；当名称/描述变更且 `stillAuto` → 重新生成 `merged.systemPrompt`。用户显式编辑过提示词则不覆盖。内置专家走 `updateBuiltin`，不受影响。

### 1.4 丰富 `CreateModal.tsx` 专家分支

新增 state `systemPrompt/appendPrompt/tools/extensions`；`catalog` + `useMemo` 算 `mcpToolNames`（复刻 ExpertForm，DetailModal.tsx:177-185）；导入 `ToolMultiSelect/ExtensionMultiSelect`（./PickList.tsx），把 `EditableTags`（DetailModal.tsx:1086）改 `export` 兜底；mode-only 块（:262-273）替换为 mode + systemPrompt TextArea(rows 6,mono) + appendPrompt + tools + extensions。submit（:107）透传这些字段，空 systemPrompt → undefined → create 自动生成。复用 key：`expert.form.systemPromptLabel/systemPromptHintCustom/appendPromptLabel/appendPromptHint/toolsLabel/extensionsLabel`。

### 1.5 DetailModal `ExpertForm`

无需改运行逻辑（身份提示词已持久化到 `expert.systemPrompt`）；仅更新失效 hint 文案（1.6）。

### 1.6 i18n

更新 `expert.form.systemPromptHintCustom`（zh-CN/en 两处）：
- zh-CN：`"新建自定义专家未填写提示词时，会自动根据名称与描述生成人格提示词；填写则优先使用你的内容。"`
- en：`"When a new custom expert has no system prompt, one is auto-generated from its name and description; your own text always takes priority."`

---

## Feature 2 — Workflow 画布设计器（React Flow + 条件分支）

### 2.1 数据模型（`packages/ipc-contract/src/index.ts`）

```ts
export interface WorkflowConditionRule {
  var: string; // 引用前序步骤：{{stepId.result}} 或 stepId
  op: "contains" | "not_contains" | "is_empty" | "is_not_empty" | "equals" | "not_equals"
    | "starts_with" | "ends_with" | "len_gt" | "len_lt";
  value?: string;
}
export type WorkflowStep =
  | ({ kind: "serial" } & WorkflowStepRef)
  | { kind: "parallel"; id: string; steps: WorkflowStepRef[] }
  | { kind: "conditional"; id: string; logic: "and" | "or"; rules: WorkflowConditionRule[];
      thenSteps: WorkflowStep[]; elseSteps?: WorkflowStep[] };
```

- `workflowStepSchema`（index.ts:1110-1123）改为 `z.lazy(() => z.union([...serial, parallel, conditional]))`（递归）。
- `TeamWorkflow`（index.ts:658-666）增加可选 `layout?: Record<string, { x: number; y: number }>`（节点画布坐标，仅 UI 用，引擎忽略；执行序仍由 `steps` 数组序决定）。
- `summarizerExpertId` 保留（隐式收尾）。

### 2.2 条件求值（新 `apps/desktop/src/main/runtime/workflowCondition.ts`）

```ts
export function evalWorkflowCondition(
  rules: WorkflowConditionRule[], logic: "and"|"or", results: Map<string,string>,
): boolean
```

- `var` 解析：剥掉 `{{ }}` 后从 `results` 取该步骤输出文本；缺失 → 视为空串。
- op 语义本地实现：contains / not_contains / is_empty（trim 后空）/ is_not_empty / equals / not_equals / starts_with / ends_with / len_gt / len_lt（`value` 转数字）。
- `and` = 全真，`or` = 任一真；`rules` 为空 → 恒真（走 then）。
- 纯函数、可单测。

### 2.3 引擎（`teamRuntime.ts`）

`runStep`（:561-599）增加 conditional 分支：

```ts
if (step.kind === "conditional") {
  const pass = evalWorkflowCondition(step.rules, step.logic, results);
  const branch = pass ? step.thenSteps : (step.elseSteps ?? []);
  // 子链与顶层相同方式递归执行（复用 runStep），子步骤结果写入共享 results
  for (const s of branch) { /* emit step_start → runStep → step_end，同 runWorkflow 主循环 */ }
}
```

- conditional 节点自身发 `workflow_step_start/end`（`kind:"conditional"`，payload 带 `pass` 判定）。
- 分支为空 → 无操作继续；`templatePrompt`（:602-608）对缺失 key 保持原样（已如此）。
- 汇总仍走末尾 summarizer（不动）。并行分支并发上限沿用 `MAX_CONCURRENT=4`（:119）。

### 2.4 画布设计器 UI（`@xyflow/react`）

- **依赖**：`@xyflow/react`（v12，MIT）加入 `apps/desktop`。
- **新组件**：`apps/desktop/src/renderer/components/expert/WorkflowCanvas.tsx`（`<ReactFlow>` + 自定义节点/边 + 画布 chrome）+ 纯函数 `workflowToGraph` / `graphToWorkflow`。
- **数据流**：嵌套 `WorkflowStep[]`（team.workflow）为源；`workflowToGraph` 派生 React Flow nodes/edges（含条件 then/else handle、并行成员）。**执行序 = `steps` 数组序**；画布拖动只改视觉位置（写入 `workflow.layout`，引擎忽略）；另提供上移/下移改执行序。
- **节点呈现**（对齐画布效果图）：
  - 任务节点：badge + 可编辑 ID + 专家名 + 提示词预览。
  - 并行节点 = 父容器（`parentId`+`extent:'parent'`）：成员并排、无连线（表示并发）。
  - 条件节点 = 父容器：条件条 + ✓/✗ 两列子链，输出边带 then/else handle 与标签（✓ 实线青碧 / ✗ 虚线琥珀）。
  - 汇总节点：末端。
  - **保底**：若父容器（subflow）机制在此交互下不稳，回退为普通节点 + 分支边（观感略降、逻辑不变）。
- **画布 chrome**：左侧节点库 rail（任务/并行/条件，点击添加到链尾或选中分支末尾）、缩放 −/⛶/＋、minimap、右键菜单（复制/删除/上移/下移）。
- **右侧编辑面板**（选中节点）：任务/汇总 = 专家 Select + 提示词 TextArea + `{{id.result}}` 引用 chips；并行 = 成员行增删；条件 = 规则行（变量+运算符+值）+ 与/或 chips + 分支结构。
- **校验**：`nodesValid()`（≥1 节点、步骤 ID 唯一、引用非空、规则合法）+ Zod `workflowStepSchema` 兜底。
- **接线**：`CreateModal` 团队分支（strategy==="workflow" 渲染画布，submit 组 `workflow`）+ `TeamForm`（DetailModal.tsx:404-600，custom 且 workflow 策略渲染画布，builtin 保持只读 `WorkflowStepsView`）。`teamStore.create/update` 已持久化 workflow（teamStore.ts:237/182）。
- 专家 Select 选项 = 团队成员（expertIds + leadExpertId）并追加仍被引用但已不在成员中的残留专家。

### 2.5 i18n 新 key（加到 **两处** locales/{zh-CN,en}.json，`expert.workflow.*`）

`title 流程设计 / Workflow designer`、`railLabel 节点库`、`addTask 任务（串行）`、`addParallel 并行`、`addConditional 条件 if/else`、`removeNode 删除节点`、`duplicateNode 复制节点`、`moveUp 上移`、`moveDown 下移`、`nodeIdLabel 步骤 ID`、`expertLabel 执行专家`、`promptLabel 提示词`、`promptHint 支持 {user} 用户消息与 {{步骤ID.result}} 引用前步输出`、`parallelTitle 并行组（成员并发执行，结果按序拼接）`、`addMember 添加成员`、`removeMember 移除`、`conditionLabel 分支条件（满足即走 ✓ 分支）`、`conditionOperator 运算符`、`conditionValue 值`、`conditionLogicAnd 全部满足（与）`、`conditionLogicOr 任一满足（或）`、`addRule 添加规则`、`thenBranch ✓ 满足条件`、`elseBranch ✗ 否则`、`summarizerLabel 结束 · 汇总`、`summarizerHint 全部步骤完成后汇总最终结果；缺省为末位成员`、`needNodes 工作流至少需要一个节点`、`emptyHint 画布还没有节点`、`zoomIn/zoomOut/zoomFit 放大/缩小/适配`、`minimap 缩略图`、`refPrev 可引用`。

### 2.6 测试

- **新 `apps/desktop/tests/workflowCondition.test.ts`**：各 op 语义、and/or 组合、空规则恒真、缺失变量视为空串、len_gt/lt 数字解析。
- **新 `apps/desktop/tests/workflowGraph.test.ts`**：`workflowToGraph`（含 conditional then/else handle、并行成员父容器）与 `graphToWorkflow`（重建嵌套 steps、位置写 layout）往返一致；ID 唯一校验。
- **`apps/desktop/tests/teamRuntime.test.ts`**（复用 `makeRuntime`/`FakeChildSession`/`makeScript`，:220-358 模式）：
  - 条件为真 → 走 then 子链（子步骤 lastPrompt 模板正确、事件含 `kind:"conditional"` + pass）。
  - 条件为假 → 走 else 子链。
  - 分支为空 → 无操作继续。
  - 嵌套条件（then 内再条件）递归执行。
  - 并行组并发（`hang=true` 证明并发）+ 结果拼接 + `{{group.result}}` 替换。
  - 现有串行测试（:302-329）保持不变。
- **`apps/desktop/tests/expertCenterStores.test.ts`**（复用临时目录模式）：Feature 1 各用例 + `teamStore` workflow 往返（create 带 conditional 字面量 + layout 持久化 / update 替换 / `workflow:null` 清除）。
- 现有 `"create 生成 custom 专家并默认 icon/tags"`（:37-46）与 `"update 合并字段并 bump updatedAt"`（:48-56）未断言 systemPrompt，新增自动生成后仍绿。

---

## 需要修改/新增的文件

| 文件 | 动作 |
|---|---|
| `apps/desktop/package.json` | **新增依赖** `@xyflow/react` |
| `apps/desktop/src/main/services/expertPrompt.ts` | **新增**：`buildExpertIdentityPrompt` |
| `apps/desktop/src/main/runtime/workflowCondition.ts` | **新增**：`evalWorkflowCondition` |
| `apps/desktop/src/main/stores/expertStore.ts` | create/update 应用身份提示词 |
| `apps/desktop/src/main/runtime/teamRuntime.ts` | `runStep` 加 conditional 递归分支 |
| `packages/ipc-contract/src/index.ts` | `WorkflowConditionRule` + `WorkflowStep` 加 conditional（递归 Zod）+ `TeamWorkflow.layout` |
| `apps/desktop/src/renderer/components/expert/WorkflowCanvas.tsx` | **新增**：React Flow 画布设计器 + `workflowToGraph`/`graphToWorkflow` |
| `apps/desktop/src/renderer/components/expert/CreateModal.tsx` | 专家绑定字段 + 画布接线 |
| `apps/desktop/src/renderer/components/expert/DetailModal.tsx` | TeamForm 换画布、`EditableTags` 导出 |
| `apps/desktop/src/renderer/i18n/locales/{zh-CN,en}.json` | `expert.workflow.*` 新 key + hint 文案 |
| `apps/desktop/tests/workflowCondition.test.ts` | **新增**：条件求值单测 |
| `apps/desktop/tests/workflowGraph.test.ts` | **新增**：graph 往返单测 |
| `apps/desktop/tests/teamRuntime.test.ts` | 条件分支 + 并行并发测试 |
| `apps/desktop/tests/expertCenterStores.test.ts` | 身份提示词 + workflow（含 conditional/layout）往返 |

不改：sessionBuilder、`expertToAgentConfig` 之外的主流程、MainView/选择流程。

---

## 验证

**单测**：`npm test`（vitest）——workflowCondition、workflowGraph、teamRuntime、expertCenterStores、i18n、ipcContract 全绿；重点关注 i18n 双文件 key 对齐。

**端到端**（`apps/desktop` 下 `npm run dev`）：
1. **Feature 1**：专家中心 → 新建专家 → 填名称/描述、提示词留空 → 保存 → 详情 systemPrompt 显示自动身份提示词（非空、非"办公助理"文案）。发任务 → 回复体现人格。改名 → 提示词随之更新；改成自定义文本再改名 → 不变。
2. **Feature 2**：新建专家团 → 策略=Workflow 编排 → 进入画布 → 从节点库添加 任务 → 并行（加成员）→ 评审任务 → 条件（`{{review.result}} 包含「通过」`，then 放发布、else 放修复）→ 选汇总专家。拖动节点、缩放、minimap 正常；保存 → 详情显示画布（内置"软件研发"仍只读）。给团队发消息 → 观察 `workflow_step_*` + `subagent_*` 卡片：并行组并发、条件命中 then/else、分支内步骤执行、末尾汇总。

**已知取舍**：旧版空提示词自定义专家改名时补齐身份提示词（`!existing.systemPrompt` 视为仍自动）；画布为结构化画布（执行序=数组序，拖动=视觉位置），不做自由连线 DAG，循环/switch 缓做；步骤 ID 可编辑，重复由 `nodesValid`/Zod 拦截；并行超过 `MAX_CONCURRENT=4` 排队（预期）。
