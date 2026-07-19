# everyBuddy 桌面 Agent 应用技术架构设计文档

> 版本：v0.1  
> 日期：2026-07-19  
> 对应 PRD：`docs/requirements.md`

---

## 1. 设计目标

1. **安全优先**：将高权限的 agent 运行时与不可信的渲染进程隔离，API Key 不出主进程。
2. **可扩展**：MVP 交付桌面端，但同一套 agent 运行时可被未来 WebUI、TUI、IM 客户端复用。
3. **可维护**：TypeScript 全栈、类型安全的 IPC 契约、清晰的包边界。
4. **高性能**：复杂工具执行不阻塞 UI，流式事件低延迟。

---

## 2. 总体架构

### 2.1 分层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  客户端表现层（Presentation Layer）                                           │
│  ┌─────────────────┐  ┌─────────────┐  ┌─────────────────────────────────┐  │
│  │  Electron App   │  │   WebUI     │  │  TUI / IM Bot                   │  │
│  │  (MVP 桌面端)    │  │  (未来)     │  │  (未来)                         │  │
│  │  React + Tailwind│  │  React/Vue  │  │  Terminal / Bot Adapter         │  │
│  └────────┬────────┘  └──────┬──────┘  └──────────────┬──────────────────┘  │
└───────────┼──────────────────┼────────────────────────┼─────────────────────┘
            │                  │                        │
            └──────────────────┴────────────────────────┘
                                │
            ┌───────────────────┴────────────────────┐
            │      客户端共享层（Client Shared）        │
            │  packages/ipc-contract                 │
            │  packages/client-core                  │
            │  - 类型定义 / Zod schema               │
            │  - React hooks / Zustand store         │
            │  - 通用 UI 组件（消息、工具卡片）        │
            └───────────────────┬────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│  传输适配层（Transport Adapter）                                              │
│  Electron 主进程：将 IPC 转换为 JSON-RPC / stdio / WebSocket                 │
│  未来 Web 服务器：HTTP / WebSocket / SSE 网关                                  │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│  AgentHost 运行时（Agent Runtime）                                            │
│  独立 Node.js 子进程                                                          │
│  - @earendil-works/pi-coding-agent                                           │
│  - AgentSession / ModelRuntime / SessionManager                              │
│  - 工具注册、工具门控（Tool Gatekeeper）、审计日志                             │
│  - 会话持久化（JSONL tree）                                                   │
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │
┌───────────────────────────────┴─────────────────────────────────────────────┐
│  本地环境集成（Local Environment）                                            │
│  - 文件系统（受限于工作区）                                                   │
│  - Shell / Git / 子进程                                                      │
│  - LLM Provider APIs                                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Agent 运行位置 | AgentHost 子进程 | 避免阻塞 Electron 主进程；崩溃隔离；天然支持未来多端 |
| 包组织 | npm workspaces | 多端共享代码，避免未来拆包痛苦 |
| 构建工具 | Electron Forge + Vite | 官方工具链，支持打包、签名、更新；开发体验好 |
| IPC 协议 | 命名空间 channel + streamId | 类型安全、事件流清晰、便于调试 |
| 凭证存储 | 系统钥匙串 | 符合平台安全规范，密钥不落地 |
| 工具权限 | 主进程门控 + 用户确认 | 防止提示注入导致的非授权操作 |

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
| 凭证存储 | 系统钥匙串封装（keytar 继任库或 `@electron/fuses` + `safeStorage`） |
| Agent 运行时 | `@earendil-works/pi-coding-agent` |
| 模型接入 | `@earendil-works/pi-ai` |
| 自定义工具 | `@earendil-works/pi-agent-core` |
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
│   ├── ipc-contract/            # 共享 IPC / API 类型与校验 schema
│   │   ├── src/
│   │   │   ├── agent.ts         # agent 事件、prompt、abort 类型
│   │   │   ├── session.ts       # 会话相关类型
│   │   │   ├── config.ts        # 配置相关类型
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── vitest.config.ts
│   ├── client-core/             # 共享客户端逻辑
│   │   ├── src/
│   │   │   ├── hooks/
│   │   │   │   └── useAgentStream.ts
│   │   │   ├── stores/
│   │   │   │   └── sessionStore.ts
│   │   │   ├── components/
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   └── ToolCallCard.tsx
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── vitest.config.ts
│   └── agent-host/              # AgentHost 运行时
│       ├── src/
│       │   ├── index.ts         # 启动入口
│       │   ├── host.ts          # AgentHost 类
│       │   ├── transport/
│       │   │   ├── jsonRpc.ts   # JSON-RPC 协议实现
│       │   │   └── stdio.ts     # stdio 传输（MVP）
│       │   ├── security/
│       │   │   └── toolGatekeeper.ts  # 工具确认拦截
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
        │   │   ├── app.ts                # 应用生命周期
        │   │   ├── windowManager.ts      # BrowserWindow 工厂
        │   │   ├── ipcRouter.ts          # IPC 路由与校验
        │   │   ├── agentHostBridge.ts    # 主进程 ↔ AgentHost 桥接
        │   │   ├── configStore.ts        # 非敏感配置
        │   │   ├── credentialService.ts  # 系统钥匙串封装
        │   │   └── toolConfirmDialog.ts  # 工具确认弹窗
        │   ├── preload/
        │   │   └── index.ts              # contextBridge 暴露 API
        │   ├── renderer/
        │   │   ├── main.tsx
        │   │   ├── App.tsx
        │   │   ├── routes/
        │   │   ├── components/
        │   │   │   ├── ChatView.tsx
        │   │   │   ├── SessionSidebar.tsx
        │   │   │   ├── SettingsPanel.tsx
        │   │   │   └── Onboarding.tsx
        │   │   └── styles/
        │   └── shared/
        │       └── vite-env.d.ts
        └── tests/
            └── e2e/
                └── smoke.spec.ts
```

---

## 5. 核心组件设计

### 5.1 AgentHost 子进程

AgentHost 是 pi-coding-agent 的封装进程，职责：

1. 监听传输层消息（MVP 为 stdio JSON-RPC）。
2. 维护 `AgentSession` 生命周期。
3. 将 pi-coding-agent 事件转换为统一 `AgentEvent`。
4. 拦截破坏性工具，向 Electron 主进程请求用户确认。
5. 会话持久化到 JSONL tree。

**入口伪代码：**

```ts
// packages/agent-host/src/index.ts
import { AgentHost } from "./host";
import { StdioTransport } from "./transport/stdio";

const transport = new StdioTransport();
const host = new AgentHost(transport);
await host.start();
```

**事件转换示例：**

```ts
// pi-coding-agent 原始事件 → IPC AgentEvent
{
  streamId: "uuid",
  type: "message_delta",
  payload: {
    role: "assistant",
    content: "正在查看..."
  }
}
```

### 5.2 Electron 主进程桥接

Electron 主进程是渲染进程与 AgentHost 之间的“适配器”：

- 启动/守护 AgentHost 子进程。
- 将渲染进程的 IPC 调用转发给 AgentHost。
- 将 AgentHost 事件广播给渲染进程。
- 管理系统钥匙串、窗口状态、全局快捷键。
- 弹出工具确认对话框。

**关键模块：**

| 模块 | 职责 |
|------|------|
| `app.ts` | 应用生命周期、单实例锁、托盘菜单 |
| `windowManager.ts` | BrowserWindow 创建、显示/隐藏、平台适配 |
| `ipcRouter.ts` | IPC channel 注册、Zod 校验、错误统一处理 |
| `agentHostBridge.ts` | fork AgentHost、心跳检测、自动重启 |
| `credentialService.ts` | OS keychain 读写封装 |
| `toolConfirmDialog.ts` | 调用 Electron dialog 展示工具确认 |

### 5.3 渲染进程 React UI

渲染进程职责单一：展示 UI、响应用户输入、通过 IPC 与主进程通信。

**核心页面：**

| 页面 | 说明 |
|------|------|
| `Onboarding` | 首次启动：选择工作区、配置 API Key |
| `ChatView` | 主对话界面 |
| `SessionSidebar` | 会话列表与操作 |
| `SettingsPanel` | 模型、主题、快捷键设置 |

---

## 6. IPC 契约

### 6.1 命名空间

- `agent:*` — agent 运行时操作
- `session:*` — 会话管理
- `config:*` — 配置与凭证
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
| `config:getModelConfig` | R → M | — | `ModelConfig` | 获取模型配置 |
| `config:setApiKey` | R → M | `{ provider, key }` | `void` | 存密钥到钥匙串 |
| `system:log` | M → R | — | `LogEntry` | 结构化日志 |
| `system:toolConfirm` | M → R | `ToolConfirmRequest` | `ToolConfirmResponse` | 工具确认弹窗 |

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
    setApiKey: (provider, key) => ipcRenderer.invoke("config:setApiKey", { provider, key }),
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

### 7.3 凭证安全

- API Key 仅存在于主进程与 AgentHost 子进程。
- 存储使用系统钥匙串，配置文件中仅存 provider 名称等非敏感信息。
- 渲染进程无法读取原始密钥。

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

### 8.1 WebUI 客户端

1. 将 AgentHost 的传输从 `stdio` 替换为 `WebSocket` 或 `HTTP + SSE`。
2. `packages/client-core` 中的 hooks/store/components 可直接复用。
3. 新增 `apps/web` 作为浏览器客户端。
4. 云端部署时在 AgentHost 前增加 OAuth/JWT 网关。

### 8.2 TUI 客户端

1. TUI 通过 JSON-RPC 直接连接 AgentHost。
2. 不复用 `pi-tui` 的 React-incompatible 组件，仅参考其交互模式。
3. 新增 `apps/tui` 包，使用如 `ink` 或 `blessed` 构建终端界面。

### 8.3 即时聊天工具客户端

1. 新增 `packages/im-adapter`。
2. 将 IM 消息（如 Slack、Discord、企业微信）映射为 `agent:prompt`。
3. 将 agent 事件流转换为 IM 消息回复。
4. 通过独立传输接入同一 AgentHost。

---

## 9. 数据流

### 9.1 一次完整对话的数据流

```
用户输入 → 渲染进程 input → IPC agent:prompt
  → 主进程校验 → 转发给 AgentHost
    → AgentSession.prompt()
      → LLM 流式生成
      → 触发 tool_execution_start
        → Tool Gatekeeper 确认
          → 用户确认（dialog）
        → 执行工具
      → tool_execution_end
      → 继续生成
    → AgentEvent 流
  → 主进程转发 agent:event
→ 渲染进程更新消息 / 工具卡片
```

### 9.2 会话持久化

- 会话数据由 pi-coding-agent 的 `SessionManager` 管理。
- 保存格式为 JSONL tree，支持未来分支与回滚。
- Electron 主进程不直接解析会话内容，仅做文件路径管理。

---

## 10. 风险与缓解

| 排名 | 风险 | 影响 | 缓解措施 |
|------|------|------|----------|
| 1 | AgentHost 子进程崩溃或卡死 | 会话中断 | 主进程心跳检测、自动重启、会话自动保存 |
| 2 | 工具调用导致数据损坏或信息泄露 | 严重 | 工具确认门控、工作区沙箱、审计日志 |
| 3 | API Key 泄露 | 严重 | 系统钥匙串、IPC 不透传 |
| 4 | Electron / Node 22 / pi-agent 版本兼容 | 构建失败 | 子进程隔离原生依赖、CI 自动化构建、版本锁定 |
| 5 | MVP 后拆分为多端成本过高 | 进度风险 | 第一天采用 workspaces + AgentHost 边界 |
| 6 | pi-agent 包 API 变动 | 维护成本 | 封装适配层，不直接在各客户端引用 pi-coding-agent 细节 |

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

- [pi-agent monorepo](https://github.com/earendil-works/pi)
- [pi.dev docs](https://pi.dev/docs/latest)
- [Electron Forge Vite plugin](https://www.electronforge.io/config/plugins/vite)
- [Electron security best practices](https://www.electronjs.org/docs/latest/tutorial/security)
