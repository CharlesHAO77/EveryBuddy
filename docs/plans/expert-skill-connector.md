# 专家·技能·连接器 设计方案

> 计划文件，确认后按此实施。侧栏已预留 `expert` 导航项（「专家·技能·连接器」），`MainView` 当前只路由 `auto`，本方案补齐 `expert` 分支并落地实体管理。
>
> **本轮实施范围（用户确认）**：先实现 **专家** + **技能**，以及 **连接器接入 MCP**；**专家团先预留**（仅登记成员 + 预留位，高级能力后续实现）。参考 EveryBuddy「buddy」产品族命名（WorkBuddy 同族概念），基于现有架构（pi-coding-agent SDK、agentConfigStore、extensions、warm-paper token）推演，不引入新依赖。

## 1. 背景与目标

当前 EveryBuddy 的 agent 人格是**两个硬编码模式**（`daily` / `coding`，见 `agentConfigStore.ts`），技能完全依赖 pi SDK 自动发现（`.pi/skills/`、`~/.agents/skills/`），用户**不可见、不可装、不可自定义**；也没有把 agent 接入外部能力（MCP / API / 数据源）的统一入口。

本方案引入四类一等实体，让用户能**自定义专家与专家团、安装/查看/自定义技能、注册连接器并预留扩展**：

| 实体 | 本质 | 本轮交付 | 预留扩展 |
|------|------|----------|----------|
| 专家 Expert | agent 人格配置（当前 daily/coding 的泛化） | ✅ 内置 2 个 + 自定义 CRUD + 任务选用 | tags 按域/能力过滤 |
| 专家团 Team | 专家分组（未来 agent 团队） | 🔒 **预留**：仅登记成员 + 预留位 | agent 团队调动子 agent / workflow 编排（后续实现） |
| 技能 Skill | 对齐 pi SDK Skill（SKILL.md，`/调用`） | ✅ 查看/安装/自定义/启停 | 技能包市场来源 |
| 连接器 Connector | 外部能力接入点 | ✅ **MCP 接入**（可用）+ 其它类型注册预留 | type/capabilities 开放枚举，分类型逐步激活 |

**核心设计哲学**：四类实体统一带 `tags: string[]`，约定保留命名空间（`domain:*` / `capability:*` / `source:*` / `team:*`）。未来任何按域/能力/来源的过滤、分组、自动路由都读 tags，**不改 schema**——这就是用户要的「预留标签后续再扩展」。

## 2. 概念模型

```
专家团 Team          ← 组织层：多专家组合成一个可切换工作组（预留自动路由）
   └─ 专家 Expert    ← 角色层：有专长/工具集/模型的 agent 人格
        ├─ 技能 Skill       ← 能力层：可 /调用 的可复用指令包（对齐 SDK Skill）
        └─ 连接器 Connector  ← 接入层：连外部能力，type 开放、capabilities 预留
```

### 2.1 专家 Expert
- **泛化**当前 `daily`/`coding`：复用 `AgentConfig` 全部字段（`systemPrompt` / `appendSystemPrompt` / `tools` / `extensions` / 三个模型 id），新增 `id` / `name` / `icon` / `description` / `tags` / `source` / `mode`（基于哪个 prompt builder）。
- **内置专家**：`daily`（办公助理）、`coding`（编码助手）——即现有两模式平移为 builtin，**零行为变更**，代码内 `const` 声明不落盘。
- **自定义专家**：从 builtin 复制或从零创建，落 `~/EveryBuddy/experts.json`。
- **选用入口**：欢迎页/新建任务的模式 tab 升级为「专家选择器」（内置 + 自定义 + 专家团成员）。

### 2.2 专家团 Team（本轮预留）
- 本轮**仅登记**：团队名/图标/成员绑定/标签 + 预留位，**不做运行时调度**。UI 在专家团 tab 明确标注「高级能力预留中」。
- **预留的演进方向**（后续实现，字段先留）：
  1. **Agent 团队形式**：主 Agent 可调动子 Agent 协作（分派子任务、汇总结果），专家团即子 Agent 池。
  2. **Agent Workflow 编排**：可视化节点编排多 Agent 流程（如 需求分析 -> 设计 -> 编码 -> 评审 的有向图）。
  3. `routingStrategy`：`"manual"`（手动切换，本轮）/ `"auto"`（dispatcher 自动路由，后续）/ `"workflow"`（编排执行，后续）。
- 团队级 `sharedTools` / `sharedExtensions`：成员默认继承，可被成员自身覆盖。
- 预留位字段已写入 schema（`routingStrategy` / `sharedTools` / `sharedExtensions`），后续激活零迁移。

### 2.3 技能 Skill
- **对齐 pi SDK 原生 Skill**：`SKILL.md`（name + description + Markdown 正文），由 `DefaultResourceLoader` 发现并注入 system prompt，`/skill-name` 调用（输入框文案已写「/调用技能与指令」）。
- 当前 EveryBuddy 完全依赖 SDK 自动发现，本次让它**可见可管**：
  - **查看已安装**：合并 SDK 发现的 global/project 技能 + EveryBuddy 安装的 + 自定义的，按来源分组展示。
  - **安装**：技能包（`SKILL.md` + 可选资源目录）安装到 `~/EveryBuddy/skills/`。MVP 来源：本地导入（选目录/zip）+ 内置示例技能库（随应用分发）。
  - **自定义**：内置 `SKILL.md` 编辑器（名称 / 描述 / Markdown 正文 / 标签）。
  - **启停**：`enabled=false` 的技能不并入 `skillsOverride`。
- **单一注入点**：`agentRuntime.ts` 构建 `DefaultResourceLoader` 时（agentRuntime.ts:297）用 `skillsOverride` 合并 enabled 技能——仅此处注入，不另起平行通道。

### 2.4 连接器 Connector
- **最外层可扩展接入点**，把外部能力接入专家/技能。「预留扩展」是其核心：
  - `type` 开放枚举：`"mcp" | "http-api" | "datasource" | "filesystem" | "custom"`，未来加类型不改 schema。
  - `capabilities: string[]` 预留：声明提供什么（`"tools" | "context" | "knowledge" | "actions"`），未来按 capability 决定注入方式。
  - `config: Record<string, unknown>`：type-specific 透传，由 per-type Zod schema 校验，新类型只加 schema。
  - `status: "connected" | "disconnected" | "error" | "reserved"`：**`reserved` 态**允许「注册并打标签」但运行时注入先 stub——用户可先把连接器目录建起来，未来逐步激活。
- 绑定：`boundExpertIds[]` / `boundSkillIds[]` 声明哪些专家/技能可用。MVP 仅记录绑定，注入逻辑预留（`reserved`/`disconnected` 不进 resource loader）。

### 2.5 预留标签统一机制
四类实体统一 `tags: string[]`，保留命名空间：
- `domain:*` 业务域（`domain:office` / `domain:frontend`）
- `capability:*` 能力（`capability:vision` / `capability:code`）
- `source:*` 来源（`source:builtin` / `source:marketplace` / `source:custom`）
- `team:*` 所属团队（Team 保存时自动同步到成员的 tags）

未来按 tags 过滤/分组/自动路由均不碰 schema。

## 3. 数据模型（单一真源：`packages/ipc-contract/src/index.ts`）

```ts
/** 专家来源 */
export type ExpertSource = "builtin" | "custom" | "installed";

/** 专家：当前 daily/coding 模式的泛化（复用 AgentConfig 字段） */
export interface Expert {
  id: string;
  name: string;
  /** emoji 或 icon key（如 "💼" / "icon-coding"） */
  icon: string;
  description: string;
  /** 基于哪个 prompt builder（决定默认工具/扩展/提示词骨架） */
  mode: AgentMode;
  /** 覆盖模式默认提示词（缺省由 main/prompts/*.ts builder 生成） */
  systemPrompt?: string;
  appendSystemPrompt?: string[];
  tools?: string[];
  extensions?: string[];
  defaultModelProviderId?: string;
  visionModelProviderId?: string;
  imageGenModelProviderId?: string;
  /** 预留标签（保留命名空间 domain:*/capability:*/source:*/team:*） */
  tags: string[];
  source: ExpertSource;
  createdAt: string;
  updatedAt: string;
}

/** 专家团 */
export interface ExpertTeam {
  id: string;
  name: string;
  icon: string;
  description: string;
  expertIds: string[];
  tags: string[];
  /** 预留路由策略：本轮仅 "manual"；后续 "auto"（dispatcher 自动路由）/"workflow"（编排执行） */
  routingStrategy: "manual" | "auto" | "workflow";
  sharedTools?: string[];
  sharedExtensions?: string[];
  createdAt: string;
  updatedAt: string;
}

/** 技能来源（对齐 SDK Skill.source + EveryBuddy 管理） */
export type SkillSource = "global" | "project" | "custom" | "builtin";

/** 技能条目（对齐 pi SDK Skill，补 EveryBuddy 管理字段） */
export interface SkillEntry {
  /** id = skill name（SDK 约定） */
  id: string;
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  source: SkillSource;
  tags: string[];
  enabled: boolean;
  installedAt?: string;
}

/** 连接器类型（开放枚举，未来扩展不改 schema） */
export type ConnectorType = "mcp" | "http-api" | "datasource" | "filesystem" | "custom";

/** 连接器状态（reserved = 已注册待实现，不进 resource loader） */
export type ConnectorStatus = "connected" | "disconnected" | "error" | "reserved";

/** 连接器 */
export interface Connector {
  id: string;
  name: string;
  type: ConnectorType;
  icon: string;
  description: string;
  /** type-specific 透传配置，由 per-type Zod schema 校验 */
  config: Record<string, unknown>;
  tags: string[];
  /** 预留：声明连接器提供什么（tools/context/knowledge/actions） */
  capabilities: string[];
  boundExpertIds: string[];
  boundSkillIds: string[];
  enabled: boolean;
  status: ConnectorStatus;
  createdAt: string;
  updatedAt: string;
}
```

> `AgentMode`、`AgentConfig` 已存在；`Expert` 字段是其超集 + 管理元数据，**不重写平行结构**，`agentConfigStore` 的 `AgentConfig` 仍是被 `agentRuntime` 消费的形式，Expert -> AgentConfig 是一处映射（§5）。

## 4. 数据落盘（遵循 configStore / agentConfigStore / modelStore 同款模式）

```
~/EveryBuddy/
├── config.json            # 已有：workspaces + tasks
├── agent-office.json      # 已有：daily 模式配置（保留，builtin expert 映射到此）
├── agent-coding.json      # 已有：coding 模式配置（保留）
├── models.json / auth.json# 已有
├── experts.json           # 新：自定义专家注册表（builtin 不落盘）
├── teams.json             # 新：专家团注册表
├── connectors.json        # 新：连接器注册表
└── skills/                # 新：安装/自定义技能（每技能一目录，含 SKILL.md + 资源）
    ├── prd-writer/
    │   └── SKILL.md
    └── ...
```

- `expertStore.ts` / `teamStore.ts` / `connectorStore.ts` / `skillStore.ts` 各管自己的 JSON/目录，模式对齐 `agentConfigStore`（可注入路径，单测友好，文件损坏 -> 空集不抛错）。
- builtin 专家/技能/连接器类型在代码内 `const` 声明，`list` 时合并展示，`source: "builtin"` 不可删。

## 5. IPC 契约（遵循 §6.1 命名空间 + §4.3 rule 2 每通道一 Zod schema）

新命名空间，全部类型/schema 集中在 `ipc-contract/src/index.ts`：

| 通道 | 方向 | 请求 | 返回 | 说明 |
|------|------|------|------|------|
| `expert:list` | R->M | - | `Expert[]` | builtin + 自定义合并 |
| `expert:create` | R->M | `CreateExpertRequest` | `Expert` | |
| `expert:update` | R->M | `UpdateExpertRequest` | `Expert` | builtin 仅可改 enabled，不可改结构 |
| `expert:delete` | R->M | `{ id }` | `void` | 仅 custom |
| `team:list/create/update/delete` | R->M | 同上 | `ExpertTeam[]` / `ExpertTeam` / `void` | |
| `skill:list` | R->M | - | `SkillEntry[]` | SDK 发现 + installed + custom 合并 |
| `skill:install` | R->M | `{ sourcePath }` | `SkillEntry` | 复制到 `~/EveryBuddy/skills/` |
| `skill:uninstall` | R->M | `{ id }` | `void` | 仅 custom/installed |
| `skill:create/update` | R->M | `SkillDraft` | `SkillEntry` | 写 SKILL.md |
| `skill:enable` | R->M | `{ id, enabled }` | `void` | |
| `connector:list/create/update/delete` | R->M | 同上 | `Connector[]` / `Connector` / `void` | |
| `connector:test` | R->M | `{ id }` | `{ status, message }` | reserved 态返回提示 |

`ElectronAPI` 扩展 `expert` / `team` / `skill` / `connector` 四组方法（§6.3 preload 形状），preload 透传。

## 6. 业务逻辑下沉（§4.3 rule 4 / rule 7）

会被未来 IM Bot 复用的 CRUD/安装逻辑放 `packages/api-gateway/src/handlers/`：
- `expert.ts` - 专家/专家团 CRUD + Expert<->AgentConfig 映射
- `skill.ts` - 技能安装/卸载/自定义（操作 `~/EveryBuddy/skills/`）
- `connector.ts` - 连接器 CRUD + per-type config 校验

`ipcRouter.ts` 只做「校验 -> 转发 -> 回包」，不写业务逻辑。

## 7. agentRuntime 集成（唯一注入点，agentRuntime.ts:297）

`createTaskSession` 构建 `DefaultResourceLoader` 处改造：
1. 读任务选中的专家配置（替代当前 `getAgentConfig(mode)`）：builtin expert 映射到现有 `agent-*.json`，custom expert 读 `experts.json`。
2. `skillsOverride`：把 enabled 的 installed/custom 技能并入（合并 SDK 自动发现的 global/project 技能）。
3. 连接器：本轮 **MCP 类型** `status === "connected"` 且 `enabled` 时，其工具作为 customTools 注入绑定专家的 session（走 SDK MCP client）；`reserved`/`disconnected` 不进 loader。其它 type（http-api/datasource）仅注册，注入预留。
4. 专家的 `tools`/`extensions` 并入 allowlist，沿用 `buildToolAllowlist` / `buildExtensionFactories`，不另起机制。

> 任务级专家选择：`TaskMeta` 增 `expertId?: string`（缺省走 mode 对应的 builtin expert，向后兼容）。

## 8. UI（ExpertView，平行 AutomationView）

`MainView` 补 `activeNav === "expert"` 分支 -> 渲染 `ExpertView`。**视觉严格对齐 `docs/demos/expert-skill-connector.html`（v3，设计唯一真源）**：顶部 4 tab → 工具栏（搜索 + 筛选 pill + 新建）→ 卡片网格；点卡片弹详情 Modal。不复用左列表/右详情骨架，改用卡片网格。

### 8.1 图标系统（新增 `apps/desktop/src/renderer/components/expert/icons.tsx`）

统一线性 SVG 规范：`viewBox="0 0 24 24"`、`fill="none"`、`stroke="currentColor"`、`stroke-width={1.8}`、`strokeLinecap="round"`、`strokeLinejoin="round"`；尺寸由 CSS 决定（`svg{width:1em;height:1em}`，容器内显式覆盖）。每个图标一个 React 组件，`size?: number` 可选覆盖。

| 图标 | 语义 | 用在 |
|------|------|------|
| `IconBriefcase` | 办公助理（daily） | 专家卡 / 详情头 |
| `IconCode` | 编码助手（coding） | 专家卡 / 详情头 |
| `IconClipboard` | 产品经理 / 子 Agent | 专家卡、团队流程图 |
| `IconPalette` | 设计顾问 | 专家卡 / 详情头 |
| `IconMonitor` | 前端专家 / 子 Agent | 专家卡、流程图 |
| `IconUser` / `IconUsers` | 专家 / 专家团 tab | 顶部 tab |
| `IconSparkles` | 技能 tab / 技能卡 | tab、技能卡 |
| `IconPlug` | 连接器 tab | 顶部 tab |
| `IconHub` | MCP | 连接器卡、类型卡 |
| `IconFolder` | 文件系统 | 连接器卡、类型卡 |
| `IconGlobe` | HTTP API | 连接器卡、类型卡 |
| `IconDatabase` | 数据源 | 连接器卡、类型卡 |
| `IconPuzzle` | 自定义 | 连接器卡、类型卡 |
| `IconBot` / `IconWorkflow` | 子 Agent 调度 / Workflow 编排（预留） | 团队预留卡、流程图 |
| `IconSearch` / `IconClose` / `IconPlus` | 工具 | 工具栏、Modal |
| `IconWarn` / `IconInfo` / `IconCheck` / `IconX` | 提示 / 状态 | 预留说明卡、绑定勾选 |

### 8.2 色彩（tint 类，映射暖纸色板 token）

卡片图标底按实体类别着色，统一 `ic-*` 类（bg = tint、color = 主色，45px 圆角 12 底 + 24px 图标）：

| 类 | 实体 | 值 |
|----|------|----|
| `ic-accent` | 专家 / 团队（绿） | bg `accent-tint` / color `accent` |
| `ic-warn` | 技能（琥珀） | bg `warn-tint` / color `warn` |
| `ic-info` | 连接器（蓝） | bg `info-tint` / color `info` |
| `ic-purple` | 自定义专家（紫） | bg `purple-tint` / color `purple` |
| `ic-neutral` | 预留位（灰） | bg `hover` / color `ink-2` |

徽章：来源 `badge-builtin`（灰）/ `badge-custom`（绿）/ `badge-installed`（琥珀）/ `badge-project`（蓝）；连接器状态点 `status-connected`（绿）/ `status-reserved`（琥珀）/ `status-disconnected`（灰）。

### 8.3 布局（ExpertView 结构）

```
ExpertView（bg-paper，纵向 flex，min-h-0 flex-1）
├─ Tabs 顶栏（h-60 border-b）：4 个 tab（icon+文字+badge 数量）
│   专家 / 专家团 / 技能 / 连接器 —— 激活态 accent-tint 底 + accent 字
├─ Toolbar（border-b）：胶囊搜索框（focus 绿边 + accent-tint 光环）+ 筛选 pill 组
│   （专家/技能按 source，连接器按 type）+ spacer + 新建按钮（按 tab 变文案）
└─ CardGrid（flex-1 overflow-y-auto）：
    grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-[16px] p-[20px_24px]
```

卡片结构：`card-icon`（46×46 圆角 12 tint 底）+ 右上角（来源徽章 / 状态点）+ `card-name`（17px 600）+ 类型徽章 + `card-desc`（13.5px ink-3）+ `card-tags`（chips）。hover：`translateY(-2px)` + accent-line 描边 + `shadow-pop`。空态：居中放大 icon + 「没有匹配的结果」文案。

### 8.4 详情 Modal

点击卡片 → 居中弹层：`backdrop`（`rgba(ink,.34)` + `backdrop-blur` 3px，fixed inset-0）→ `modal`（640px 宽、圆角 18、shadow-modal、入场 `translateY(12px)` + fade）。头部（icon 52px + 标题 + 状态徽章 + 关闭键）→ 主体（表单区）→ 底部操作按钮（primary / ghost / danger）。遮罩点击 / 关闭键 / Esc 关闭。专家团预留卡弹层含**流程图**（主 Agent → 子 Agent → 汇总）。

### 8.5 表单控件（Modal 内）

- 输入：form-input / textarea（mono 字体 / select），focus 绿边 + accent-tint 光环。
- chips：可删 chip（accent-tint 底 + `×` 按钮）、chip-off 灰态、chip-add 虚线加号。
- switch：on 态 accent 轨道。
- 绑定专家：bind-grid / bind-item，勾选 = accent-tint 底 + accent 对勾。
- 连接器类型：type-grid / type-card（active = accent 边 + 底；disabled = 灰显「即将推出」）。
- config：cfg-row（MCP：传输方式 stdio/SSE + Server 命令 + 环境变量）。
- 预留说明：note-warn（预留中）/ note-info（已接入），圆角 12 + 边框 + tint 底。

### 8.6 专家团 tab（预留态）

卡片区 = 现有团队卡 + 2 张预留卡（`子 Agent 调度` / `Workflow 编排`，ic-neutral 灰显 + 「预留」徽章）。点开弹层：成员多选 + note-warn 说明（Agent 团队 / Workflow 编排为后续演进，字段已预留零迁移）+ 流程图。`routingStrategy` 下拉仅 `manual` 可选，`auto` / `workflow` 灰显「即将推出」。

## 9. 内置内容（随应用分发）

- **内置专家**：办公助理（daily）、编码助手（coding）。
- **内置示例技能**（`~/EveryBuddy/skills/` 首次启动种子，可卸载）：`prd-writer`（产品需求文档撰写）、`meeting-notes`（会议纪要整理）、`commit-helper`（约定式提交信息）。
- **连接器类型 schema**：本轮 `mcp`（完整接入，stdio/SSE 传输）+ `filesystem`（路径白名单，可激活）可用；`http-api`/`datasource`/`custom` 仅注册预留。

## 10. 实现步骤（每步保持编译 + 测试绿）

> 优先级：专家 + 技能 + 连接器 MCP 本轮交付；专家团仅落预留位。

| 步骤 | 内容 | 涉及包 |
|------|------|--------|
| 0 | 计划落库 + 更新 demo HTML + git commit 一次 | docs/ |
| 1 | `ipc-contract`：Expert/Team/SkillEntry/Connector 类型 + Zod schema + ElectronAPI 扩展 | packages/ipc-contract |
| 2 | `api-gateway` handlers：expert/skill/connector CRUD + Expert<->AgentConfig 映射 | packages/api-gateway |
| 3 | main 进程 stores：expertStore/teamStore/skillStore/connectorStore + ipcRouter 通道注册 + preload 透传 | apps/desktop/main, preload |
| 4 | agentRuntime 集成：expert 配置读取 + skillsOverride 注入 + MCP 工具注入 + TaskMeta.expertId | apps/desktop/main |
| 5 | renderer：`expert/icons.tsx`（SVG 线性图标集）+ `ExpertView.tsx`（4 tab + 搜索筛选工具栏 + 卡片网格）+ 各 tab 卡片组件 + `DetailModal.tsx`（§8 视觉规范）+ zustand stores | apps/desktop/renderer |
| 6 | MainView 路由 expert 分支 + 欢迎页专家选择器 | apps/desktop/renderer |
| 7 | 内置专家/示例技能 + MCP 连接器示例（GitHub MCP）+ 首次启动种子 | apps/desktop/main |
| 8 | 单测：stores CRUD、Expert<->AgentConfig 映射、skillsOverride 合并、MCP config 校验 | tests/ |
| 后续 | 专家团高级能力：子 Agent 调度 + workflow 编排（schema 已预留，单独排期） | 待定 |

## 11. 风险与缓解

| 风险 | 缓解 |
|------|------|
| Expert 与现有 `agent-*.json` 双写漂移 | builtin expert 映射到 `agent-*.json`（只读消费），custom expert 独立 `experts.json`；映射集中在 api-gateway 一处 |
| `skillsOverride` 与 SDK 自动发现重复 | 以 SDK 发现为底，EveryBuddy 管理的技能 `source` 标记区分，合并时按 name 去重（installed 优先于同名 project） |
| 连接器 `reserved` 态让用户困惑 | UI 明确标注「已注册，运行时接入即将推出」+ status 状态点，不假装已生效 |
| tags 命名空间被滥用 | 文档约定保留前缀（`domain:*` 等），UI 输入时给出建议补全；不强制校验（保留灵活性） |
| TaskMeta 增字段破坏旧会话 | `expertId?` 可选，缺省回退 mode 对应 builtin expert，旧数据零迁移 |
