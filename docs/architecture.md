# everyBuddy 桌面 Agent 应用技术架构设计文档

> 版本：v0.2  
> 日期：2026-08-03  
> 对应 PRD：`docs/requirements.md`

---

## 1. 设计目标

1. **安全优先**：API Key 仅存在于主进程中，渲染进程不接触原始密钥。
2. **务实可扩展**：MVP 交付桌面端，架构预留 IM Bot 接入点，不追求一次性支持所有客户端形态。
3. **可维护**：TypeScript 全栈、类型安全的 IPC 契约、清晰的包边界。
4. **高性能**：agent 全异步操作，不阻塞主进程事件循环，流式事件低延迟。

---

## 2. 总体架构

### 2.1 分层架构

```
┌───────────────────────────────────────────────────────────────┐
│               Electron 桌面端 (Desktop App)                    │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  渲染进程 (Renderer Process)                            │  │
│  │  React 19 + Tailwind CSS 4 + shadcn/ui                  │  │
│  │  Zustand 状态管理                                        │  │
│  │  职责：纯 UI 展示与用户交互                                │  │
│  │  无 sandbox，contextIsolation: true                       │  │
│  └────────────────────┬────────────────────────────────────┘  │
│                       │ contextBridge (最小 API)               │
│  ┌────────────────────▼────────────────────────────────────┐  │
│  │  主进程 (Main Process)                                  │  │
│  │                                                         │  │
│  │  ┌──────────────┐  ┌────────────────────────────────┐   │  │
│  │  │ 应用生命周期  │  │  API Gateway (本地路由)          │   │  │
│  │  │ 窗口/托盘    │  │  统一请求入口，未来 IM Bot 接入点 │   │  │
│  │  │ 快捷键       │  └────────┬───────────────────────┘   │  │
│  │  └──────────────┘           │                           │  │
│  │                     ┌───────▼───────────────────────┐   │  │
│  │                     │  AgentRuntime (pi-coding-agent) │   │  │
│  │                     │  - AgentSession / 工具执行     │   │  │
│  │                     │  - Tool Gatekeeper             │   │  │
│  │                     │  - 会话持久化 (JSONL tree)     │   │  │
│  │                     │  - 审计日志                     │   │  │
│  │                     └───────────────────────────────┘   │  │
│  │                                                         │  │
│  │  ┌──────────────┐  ┌────────────────────────────────┐   │  │
│  │  │ 系统钥匙串    │  │  配置管理 / 工作区管理          │   │  │
│  │  │ AuthStorage   │  │  electron-store                │   │  │
│  │  └──────────────┘  └────────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            │                                     │
    ┌───────▼───────┐                    ┌────────▼────────┐
    │  LLM Provider  │                    │  IM Bot (未来)   │
    │  APIs          │                    │  ─ 通过 API     │
    │  (Anthropic/   │                    │    Gateway 接入  │
    │   OpenAI/...)  │                    └─────────────────┘
    └───────────────┘
```

### 2.2 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Agent 运行位置 | Electron 主进程 | agent 全异步，不阻塞；消除子进程 IPC 死锁；简化会话管理 |
| 包组织 | npm workspaces | 类型定义、工具、UI 组件共享 |
| 构建工具 | Electron Forge + Vite | 官方工具链，支持打包、签名、更新 |
| IPC 协议 | contextBridge + invoke/on | Electron 原生 IPC，无需额外序列化层 |
| API Key 输入 | 主进程原生 dialog | 渲染进程全程不接触原始密钥 |
| 凭证存储 | pi-coding-agent 内置 AuthStorage（系统钥匙串 + 加密文件） | 符合平台安全规范，密钥不落地 |
| 工具权限 | 主进程门控 + 用户确认 | 防止提示注入导致的非授权操作 |
| 多端扩展 | API Gateway 抽象层 | 桌面端内部函数路由，未来 IM Bot 可通过同一接口接入 |

---

## 3. 技术栈

| 层级 | 技术 |
|------|------|
| 桌面运行时 | Electron 35+ |
| 前端框架 | React 19 + TypeScript 5.7 |
| 构建工具 | Electron Forge 7 + Vite 6 |
| 样式方案 | Tailwind CSS 4 + Radix UI / shadcn/ui |
| 状态管理 | Zustand 5 |
| 本地配置 | electron-store |
| 凭证存储 | pi-coding-agent 内置 AuthStorage（系统钥匙串 + 加密文件） |
| Agent 运行时 | `@earendil-works/pi-coding-agent`（自带 TUI） |
| 校验 | Zod |
| 测试 | Vitest + Playwright |
| 代码规范 | Biome |
| 包管理 | npm 10 + workspaces |

---

## 4. 项目结构

```
everyBuddy/
├── package.json                 # root，workspaces、scripts
├── tsconfig.json                # TypeScript project references
├── biome.json                   # 代码规范与格式化
├── package-lock.json
├── docs/
│   ├── requirements.md          # PRD
│   └── architecture.md          # 本文档
├── packages/
│   ├── ipc-contract/            # IPC 类型契约（单文件）
│   │   ├── src/
│   │   │   └── index.ts         # 所有 IPC 类型定义与 Zod schema
│   │   ├── package.json
│   │   └── vitest.config.ts
│   └── api-gateway/             # API Gateway 抽象层
│       ├── src/
│       │   ├── index.ts         # 路由入口
│       │   ├── gateway.ts       # Gateway 类
│       │   ├── handlers/
│       │   │   ├── agent.ts     # agent 操作路由
│       │   │   ├── session.ts   # 会话操作路由
│       │   │   └── config.ts    # 配置操作路由
│       │   ├── types.ts         # 请求/响应类型
│       │   └── index.ts
│       ├── package.json
│       └── vitest.config.ts
└── apps/
    └── desktop/                 # Electron + React 桌面应用（MVP）
        ├── forge.config.ts
        ├── vite.main.config.ts
        ├── vite.preload.config.ts
        ├── vite.renderer.config.ts
        ├── package.json
        ├── src/
        │   ├── main/
        │   │   ├── index.ts              # Electron 入口
        │   │   ├── app.ts                # 应用生命周期、单实例锁
        │   │   ├── windowManager.ts      # BrowserWindow 工厂
        │   │   ├── ipcRouter.ts          # IPC 路由与校验
        │   │   ├── agentRuntime.ts       # pi-coding-agent 运行时集成
        │   │   ├── tools/                # 平台化工具配置（见 §5.1）
        │   │   │   ├── toolAvailability.ts # 探测 bash（真实 Git Bash）/ rg / fd，组装动态工具清单
        │   │   │   ├── grepTool.ts       # 纯 Node grep 兜底（rg 缺失时覆盖内置）
        │   │   │   └── findTool.ts       # 纯 Node find 兜底（fd 缺失时覆盖内置）
        │   │   ├── modelStore.ts         # 模型维护唯一模块（models.json + auth.json，SDK 原生格式）
        │   │   ├── apiGatewayBridge.ts   # 主进程 ↔ API Gateway 桥接
        │   │   ├── configStore.ts        # 非敏感配置（workspaces + tasks）
        │   │   ├── apiKeyDialog.ts       # 原生 API Key 输入对话框
        │   │   └── toolConfirmDialog.ts  # 工具确认弹窗
        │   ├── preload/
        │   │   └── index.ts              # contextBridge 暴露 API
        │   ├── renderer/
        │   │   ├── main.tsx
        │   │   ├── App.tsx
        │   │   ├── routes/
        │   │   ├── hooks/
        │   │   │   └── useAgentStream.ts
        │   │   ├── stores/
        │   │   │   └── sessionStore.ts
        │   │   ├── components/
        │   │   │   ├── ChatView.tsx
        │   │   │   ├── SessionSidebar.tsx
        │   │   │   ├── SettingsPanel.tsx
        │   │   │   ├── Onboarding.tsx
        │   │   │   ├── MessageBubble.tsx
        │   │   │   └── ToolCallCard.tsx
        │   │   └── styles/
        │   └── shared/
        │       └── vite-env.d.ts
        └── tests/
            └── e2e/
                └── smoke.spec.ts
```

---

## 5. 核心组件设计

### 5.1 AgentRuntime 主进程集成

AgentRuntime 是对 `@earendil-works/pi-coding-agent` SDK 的封装层，职责：

1. 初始化并管理 pi-coding-agent 实例，复用其内置的 TUI、SessionManager、AuthStorage。
2. 将 pi-coding-agent 事件转换为统一 `AgentEvent` 供渲染进程消费。
3. 拦截破坏性工具，调用 `toolConfirmDialog` 请求用户确认。
4. 会话持久化（pi-coding-agent 的 JSONL tree 格式）。
5. 通过 API Gateway 暴露统一接口，供主进程内部及未来 IM Bot 调用。

**集成方式：**

```ts
// apps/desktop/src/main/agentRuntime.ts
import { CodingAgent } from “@earendil-works/pi-coding-agent”;

export class AgentRuntime {
  private agent: CodingAgent;

  constructor() {
    this.agent = new CodingAgent({
      // 凭证由 pi-coding-agent 内置 AuthStorage 管理
      // 主进程通过 IPC 触发 AuthStorage 的配置流程
      // 渲染进程不接触密钥
    });
  }

  async prompt(request: PromptRequest): Promise<EventSource> {
    return this.agent.prompt(request);
  }

  async abort(streamId: string): Promise<void> {
    return this.agent.abort(streamId);
  }

  async listSessions(): Promise<SessionSummary[]> {
    return this.agent.listSessions();
  }
}
```

**事件流：**

```ts
// pi-coding-agent 原始事件 → IPC AgentEvent
{
  streamId: “uuid”,
  type: “message_delta”,
  payload: {
    role: “assistant”,
    content: “正在查看...”
  }
}
```

> **关于 TUI**：pi-coding-agent 内置 TUI 界面。桌面端 React UI 是默认界面，TUI 可作为备选或调试工具使用，不参与桌面端主交互流程。

**工具可用性探测（平台化工具配置）：**

`main/tools/` 目录实现平台化的 Agent 工具配置（见 `toolAvailability.ts`）：

- **bash（Windows 关键修复）**：SDK 的 `getShellConfig` 在 Windows 上只查
  `%ProgramFiles%\Git\bin\bash.exe`（新版 Git 的 bash 在 `usr\bin\`，会漏），随后
  `where bash.exe` 取第一个匹配，Electron 主进程 PATH 中 System32 靠前会命中
  `C:\Windows\System32\bash.exe`（WSL stub）。`toolAvailability` 改为优先枚举
  `bin\` + `usr\bin\` 的 Git Bash 已知路径，再对 `where` 输出逐条跳过 WSL stub；
  命中后用 `createBashToolDefinition(cwd, { shellPath })` 经 customTools 同名覆盖
  内置 bash，让命令走真实 Git Bash。未命中则静默排除 bash 工具。
- **grep/find（纯 Node 兜底）**：SDK 内置 grep/find 分别硬依赖外部 rg/fd 二进制
  （首次使用从 GitHub 自动下载，国内/离线网络易失败）。`toolAvailability` 探测
  rg/fd 是否在 PATH 或 `~/.pi/agent/bin`；缺失时注入纯 Node 实现覆盖内置——
  grep 用 `grepTool.ts`（tinyglobby 枚举 + Node 正则逐行匹配），find 用
  `findTool.ts` 的 `FindOperations`（SDK `createFindToolDefinition` 原生支持
  customOps.glob 纯 Node 路径）。grep/find 因此永不缺失，且不触发下载。
- 探测结果为机器级快照，进程内缓存一次；`agentRuntime.createTaskSession` 据此
  组装动态 `tools` allowlist 与 `customTools`。

### 5.2 Electron 主进程

Electron 主进程职责：

- 创建和管理 BrowserWindow、系统托盘、全局快捷键。
- 通过 `ipcRouter` 处理渲染进程的 IPC 请求。
- 直接调用 `AgentRuntime` 处理 agent 操作（无中间传输层）。
- 管理系统钥匙串、窗口状态。
- 弹出工具确认对话框和 API Key 输入对话框。

**关键模块：**

| 模块 | 职责 |
|------|------|
| `app.ts` | 应用生命周期、单实例锁、托盘菜单 |
| `windowManager.ts` | BrowserWindow 创建、显示/隐藏、平台适配 |
| `ipcRouter.ts` | IPC channel 注册、Zod 校验、错误统一处理 |
| `agentRuntime.ts` | pi-coding-agent 运行时封装，直接调用 |
| `tools/toolAvailability.ts` | 探测 bash（真实 Git Bash）/ rg / fd，生成动态工具清单 |
| `tools/grepTool.ts` | 纯 Node grep 兜底（rg 缺失时覆盖内置，见 §5.1） |
| `tools/findTool.ts` | 纯 Node find 兜底（fd 缺失时覆盖内置，见 §5.1） |
| `apiGatewayBridge.ts` | 将 API Gateway 请求路由到 AgentRuntime |
| `apiKeyDialog.ts` | 调用 Electron 原生 dialog 输入 API Key，委托 AuthStorage 存储 |
| `toolConfirmDialog.ts` | 调用 Electron dialog 展示工具确认 |

### 5.3 渲染进程 React UI

渲染进程职责单一：展示 UI、响应用户输入、通过 IPC 与主进程通信。**不持有 API Key**。

**核心页面：**

| 页面 | 说明 |
|------|------|
| `Onboarding` | 首次启动：选择工作区、触发 API Key 原生 dialog |
| `ChatView` | 主对话界面 |
| `SessionSidebar` | 会话列表与操作 |
| `SettingsPanel` | 模型、主题、快捷键设置 |

---

## 6. IPC 契约

渲染进程与主进程之间通过 Electron 原生 IPC 通信。agent 运行时的操作不再经过 IPC（主进程内部直接调用），IPC 仅用于：

- 渲染进程触发操作（发送消息、中止、切换会话）
- 主进程推送事件（流式更新、工具确认请求、日志）

### 6.1 命名空间

- `agent:*` — agent 操作触发与事件推送
- `session:*` — 会话管理
- `config:*` — 配置与凭证（**不传递 API Key**）
- `system:*` — 应用级事件

### 6.2 核心通道定义

| 通道 | 方向 | 请求类型 | 返回类型 | 说明 |
|------|------|----------|----------|------|
| `agent:prompt` | R → M | `PromptRequest` | `{ streamId: string }` | 发送用户消息 |
| `agent:abort` | R → M | `{ streamId: string }` | `void` | 中止流 |
| `agent:event` | M → R | — | `AgentEvent` | 统一事件流 |
| `session:list` | R → M | — | `SessionSummary[]` | 列出会话 |
| `session:load` | R → M | `{ id: string }` | `SessionTree` | 加载会话 |
| `session:save` | R → M | `SessionTree` | `void` | 保存会话 |
| `config:getModelConfig` | R → M | — | `ModelConfig` | 获取模型配置（不含 API Key） |
| `config:openApiKeyDialog` | R → M | `{ provider: string }` | `void` | 触发主进程弹出原生 API Key 输入框 |
| `system:log` | M → R | — | `LogEntry` | 结构化日志 |
| `system:toolConfirm` | M → R | `ToolConfirmRequest` | `ToolConfirmResponse` | 工具确认弹窗 |

> **安全关键**：没有 `config:setApiKey` 通道。渲染进程无法传递 API Key。用户通过主进程的原生 dialog 输入密钥。

### 6.3 Preload API 形状

```ts
// apps/desktop/src/preload/index.ts
import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "@everybuddy/ipc-contract";

const api: ElectronAPI = {
  agent: {
    prompt: (req) => ipcRenderer.invoke("agent:prompt", req),
    abort: (streamId) => ipcRenderer.invoke("agent:abort", streamId),
    onEvent: (cb) => {
      const handler = (_: any, event: any) => cb(event);
      ipcRenderer.on("agent:event", handler);
      return () => ipcRenderer.off("agent:event", handler);
    },
  },
  session: {
    list: () => ipcRenderer.invoke("session:list"),
    load: (id) => ipcRenderer.invoke("session:load", id),
    save: (session) => ipcRenderer.invoke("session:save", session),
  },
  config: {
    getModelConfig: () => ipcRenderer.invoke("config:getModelConfig"),
    openApiKeyDialog: (provider) => ipcRenderer.invoke("config:openApiKeyDialog", provider),
    // ⚠️ 无 setApiKey —— API Key 通过主进程原生 dialog 输入
  },
};

contextBridge.exposeInMainWorld("electronAPI", api);
```

---

## 7. 安全设计

### 7.1 渲染进程隔离

- `contextIsolation: true`：preload 与页面 JS 隔离。
- `sandbox: true`：渲染进程默认沙箱。
- 严格 Content-Security-Policy，禁止内联脚本。

### 7.2 IPC 安全

- 所有 IPC 请求/响应使用 Zod 运行时校验。
- 主进程不信任渲染进程的任何输入。
- 仅暴露最小必要 API。

### 7.3 模型与凭证：统一交给 pi-ai 原生文件

**模型维护统一交给 pi-ai 原生两件套**，App 不维护平行注册表。`~/EveryBuddy/` 下的配置文件所有权：

| 文件 | 所有权 | 内容 | 可编辑性 |
| ---- | ------ | ---- | -------- |
| `config.json`（0600） | 应用（`configStore.ts`） | 仅 `workspaces` + `tasks`，**无模型、无密钥** | 应用真源，可手改 |
| `models.json` | 应用（`modelStore.ts`）→ pi SDK `ModelConfig` 消费 | provider 配置（SDK `ProviderConfigSchema` 原生格式） | 应用直写，勿手改 |
| `auth.json`（0600） | 应用（`modelStore.ts`）→ pi SDK `AuthStorage` 消费 | 凭证（SDK `AuthCredential` 格式 `{ providerId: { type:"api_key", key } }`） | 应用直写，勿手改 |
| `models-store.json` | pi SDK 内部（远程目录缓存） | **已移除**；`allowModelNetwork:false` 时 SDK 只读缓存、永不写，`modelsStorePath` 重定向到系统临时目录兜底 | 不落盘 |

- **模型配置**：`modelStore.ts` 是 models.json + auth.json 唯一读写入口，按 SDK 原生格式直写；`ModelRuntime.create({ modelsPath, authPath })` 直接消费，**无派生/同步步骤**（旧 `configStore.models[]` 平行注册表与 `syncModelsJson` 已移除）。
- **凭证**：密钥只写 `auth.json`（0600，原子写），SDK `RuntimeCredentials`→`AuthStorage` 自动读取（解析优先级：运行时覆盖 → auth.json → 环境变量 → models.json 兜底）。`config.json` 不存任何明文密钥。
- **API Key 输入流程**：用户点击"配置 API Key" → `config:setApiKey` IPC → 主进程 `modelStore.setApiKey()` 写 auth.json → 重建 ModelRuntime。渲染进程全程不接触原始密钥字符串，仅见 `hasApiKey` 布尔。
- **SDK 版本说明**：pi-mono master 的公共 `AuthStorage` 类尚未随 `@earendil-works/pi-coding-agent` 发布（0.83.0/0.84.1 均只导出只读的 `readStoredCredential`），故应用按 SDK `AuthCredential` 格式直写 auth.json；待 SDK 发布 `AuthStorage` 后，`modelStore.writeAuth` 内部可换为 `AuthStorage.set()`，一处改动即可升级。
- 主进程不再维护独立的 `credentialService.ts`，凭证写入收口于 `modelStore.ts`。

### 7.4 工具执行安全

- **工具门控（Tool Gatekeeper）** 拦截以下工具：
  - 文件写操作：`write`、`edit`、删除类命令
  - Shell 执行：`bash`
- 弹窗展示工具名、参数、影响范围。
- 支持按工作区配置白名单（如允许 `git status`，拒绝 `rm -rf`）。
- 所有工具调用记录审计日志。

### 7.5 工作区沙箱

- Agent 文件操作必须位于用户选定的工作区目录内。
- 主进程校验路径，禁止 `..` 或符号链接逃逸。
- 跨工作区操作需重新选择工作区。

---

## 8. 未来扩展设计

### 8.1 API Gateway 抽象层

`packages/api-gateway` 是桌面端内部与未来外部客户端的统一接口抽象层。它定义了标准化的请求/响应格式，使得：

- 桌面端（Electron 主进程）通过函数调用路由到 AgentRuntime
- 未来 IM Bot 通过 HTTP/WebSocket 连接到同一 Gateway

**API Gateway 接口定义：**

```ts
// packages/api-gateway/src/types.ts

export type GatewayRequest = {
  type: "prompt" | "abort" | "list_sessions" | "load_session" | "save_session";
  payload: unknown;
  meta?: {
    clientId: string;     // "desktop" | "im-bot" | ...
    timestamp: string;
  };
};

export type GatewayResponse = {
  success: boolean;
  data?: unknown;
  error?: { code: string; message: string };
};
```

**本地模式（桌面端）：**

```ts
// 主进程内部直接调用，无网络开销
const gateway = new Gateway(agentRuntime);
const result = await gateway.handle({
  type: "prompt",
  payload: { text: "你好" },
  meta: { clientId: "desktop", timestamp: new Date().toISOString() },
});
```

### 8.2 IM Bot 客户端（未来）

1. 新增 `packages/im-adapter`，将 IM 消息（Slack、Discord、企业微信）映射为 Gateway 请求。
2. 新增 `apps/bot-server` 轻量 HTTP 服务，监听 IM Webhook。
3. `bot-server` 通过 HTTP 调用 API Gateway（未来可在独立进程中启动 Gateway + AgentRuntime）。
4. 未来需要 WebUI 时，可直接从 `apps/desktop/src/renderer/` 中提取 hooks/stores/components 到共享包。

```
IM Bot Webhook → apps/bot-server → HTTP → API Gateway → AgentRuntime
```

### 8.3 部署演进路径

| 阶段 | 架构 | 说明 |
|------|------|------|
| MVP | 桌面端 + 内部 Gateway 函数调用 | 单一进程，零网络开销 |
| 添加 IM Bot | 桌面端 + Gateway + bot-server | bot-server 与桌面端共享进程 |
| 独立部署 | Gateway + AgentRuntime 独立进程 | 桌面端和 IM Bot 通过 IPC/HTTP 连接 |

MVP 阶段所有 UI 逻辑集中在 `apps/desktop/src/renderer/` 中，未来新增 WebUI 时再从中提取共享包。

---

## 9. 数据流

### 9.1 一次完整对话的数据流

```
用户输入 → 渲染进程 input → IPC agent:prompt
  → 主进程 ipcRouter 校验 → AgentRuntime.prompt()
    → pi-coding-agent LLM 流式生成
    → 触发 tool_execution_start
      → Tool Gatekeeper 拦截
        → 主进程 toolConfirmDialog（原生弹窗）
        → 用户确认 → 放行
      → 执行工具
    → tool_execution_end
    → 继续生成
  → AgentEvent 流
  → 主进程广播 agent:event
→ 渲染进程更新消息 / 工具卡片
```

**关键简化**：主进程直接调用 AgentRuntime，无子进程 IPC、无 JSON-RPC 序列化、无心跳检测。

### 9.2 会话持久化

- 会话数据由 pi-coding-agent 的 `SessionManager` 管理。
- 保存格式为 JSONL tree，支持未来分支与回滚。
- 主进程通过 API Gateway 的会话操作直接读写文件，职责清晰。

---

## 10. 风险与缓解

| 排名 | 风险 | 影响 | 缓解措施 |
|------|------|------|----------|
| 1 | AgentRuntime 崩溃或内存泄漏导致整个应用不可用 | 会话中断 | 使用 `try/catch` 包裹 agent 操作，主进程捕获未处理异常后自动重启应用 |
| 2 | 工具调用导致数据损坏或信息泄露 | 严重 | 工具确认门控、工作区沙箱、审计日志 |
| 3 | API Key 泄露 | 严重 | 原生 dialog 输入、AuthStorage 加密存储、渲染进程不接触密钥 |
| 4 | Electron / Node / pi-coding-agent 版本兼容 | 构建失败 | 版本锁定、CI 自动化构建、子进程隔离原生依赖（必要时） |
| 5 | 渲染进程沙箱限制导致部分 Electron API 不可用 | 功能受限 | contextIsolation + preload 白名单，不启用 sandbox |
| 6 | pi-coding-agent 包 API 变动 | 维护成本 | AgentRuntime 封装适配层，不直接暴露 pi-coding-agent 细节 |

---

## 11. 开发、构建与发布

### 11.1 开发命令

```bash
# 安装依赖
npm install

# 启动桌面应用开发模式
npm run dev

# 运行测试
npm run test

# 构建所有包
npm run build

# 打包桌面应用
npm run make
```

### 11.2 构建流程

1. TypeScript 编译 `packages/*`。
2. Vite 构建渲染进程。
3. Vite 构建主进程与 preload。
4. Electron Forge 打包、生成安装包。

### 11.3 发布准备

- 配置代码签名证书（Windows / macOS）。
- 配置自动更新服务器（未来版本）。
- CI 流水线覆盖：lint → test → build → package。

---

## 12. 参考

- [pi monorepo](https://github.com/earendil-works/pi)（含 pi-coding-agent）
- [pi.dev docs](https://pi.dev/docs/latest)
- [Electron Forge Vite plugin](https://www.electronforge.io/config/plugins/vite)
- [Electron security best practices](https://www.electronjs.org/docs/latest/tutorial/security)
