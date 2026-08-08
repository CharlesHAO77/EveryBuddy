# agents.md — everyBuddy 仓库协作指南

> 本文件面向在本仓库中工作的 AI 编程助手与人类开发者。任何改动前请先读本文件与 `docs/architecture.md`。

## 1. 项目简介

**everyBuddy** 是一款面向开发者的本地桌面 AI 助手（Electron + React），核心 agent 能力由 `@earendil-works/pi-coding-agent` 提供。MVP 仅交付桌面端，架构为未来 IM Bot / WebUI 预留接入点。

- PRD：`docs/requirements.md`
- 架构：`docs/architecture.md`
- pi-coding-agent SDK文档: `docs/pi-coding-sdk.md`

## 2. 仓库结构（npm workspaces monorepo）

```
everyBuddy/
├── packages/
│   ├── ipc-contract/   # 渲染↔主进程 IPC 类型契约 + Zod schema（无运行时逻辑）
│   └── api-gateway/    # 统一请求路由抽象层（桌面端函数调用 / 未来 IM Bot 接入）
└── apps/
    └── desktop/        # Electron + React 桌面应用（MVP）
        └── src/
            ├── main/       # 主进程：窗口/IPC/AgentRuntime/凭证/对话框
            ├── preload/    # contextBridge 最小 API
            ├── renderer/   # React UI（纯展示，不持密钥）
            └── shared/     # 跨进程共享的类型声明
```

## 3. 包边界与导入规则

| 包 | 可被导入 | 可导入 | 禁止 |
| ---- | ---------- | -------- | ------ |
| `@everybuddy/ipc-contract` | 任意 | `zod` | 任何运行时逻辑、Electron/Node API |
| `@everybuddy/api-gateway` | 主进程 / 未来 bot-server | `ipc-contract` | Electron、React、渲染进程 |
| `@everybuddy/desktop`（main） | — | `ipc-contract`、`api-gateway`、`electron`、`pi-coding-agent` | — |
| `@everybuddy/desktop`（renderer） | — | `ipc-contract`（仅类型）、React、Zustand | `electron`、`api-gateway`、任何 Node API |

**铁律**：渲染进程不直接 import `electron` 或 `api-gateway`；与主进程的唯一通道是 `window.electronAPI`（由 preload 暴露）。

## 4. 编码规范

### 4.0 核心原则：单一真源（Single Source of Truth）

**每个共享概念（类型、IPC 契约、校验 schema、通道名、业务逻辑）只在一处定义，其它地方一律 `import` 引用，绝不复制。** 任何服务（桌面主进程 / 渲染进程 / 未来 IM Bot / WebUI）需要共享能力时，去唯一出处扩展；禁止在各自包内维护平行副本。

> 违反判据：改动一个共享概念需要同步修改**不止一个文件**，即已违反本原则。

### 4.1 工程约定

- TypeScript 严格模式（`strict`、`noUncheckedIndexedAccess`），见 `tsconfig.base.json`。
- 格式化与 lint：Biome（`biome.json`），双引号、分号、尾逗号、2 空格、行宽 100。
- 命名：文件 `camelCase.ts`，组件 `PascalCase.tsx`，类型/接口 `PascalCase`。
- 共享包为 ESM（`"type": "module"`）；desktop 主进程为 CJS（兼容 Electron Forge）。
- 共享包**以源码导出**（`exports.types/default` 指向 `src/index.ts`），desktop 通过 Vite alias 解析到源码——MVP 阶段无需预编译共享包。
- 类型导入优先用 `import type`。
- 测试类文件统一放到单独的tests文件夹下，不能混合在一起

### 4.2 共享物归属（每个概念只有一个家）

| 概念 | 唯一出处 | 说明 |
| ------ | ---------- | ------ |
| 跨进程类型 / Zod schema / IPC 通道名 | `packages/ipc-contract/src/index.ts` | `PromptRequest`、`AgentEvent`、`TaskMeta` 等；每个 IPC 通道恰好一个 schema |
| 渲染层消息模型 | 从 `ipc-contract` 类型**派生** | `ChatMessage` 基于 `HistoryMessage` 扩展，不重写平行接口 |
| 应用路径 / 默认目录 | `apps/desktop/src/main/configStore.ts` | `APP_ROOT` / `SESSIONS_DIR`（仅会话 JSONL）/ `WORK_SPACES_DIR`（用户空间落盘 + 临时任务工作目录），其它文件 import |
| SDK→AgentEvent 事件归一化 | `apps/desktop/src/main/agentRuntime.ts` | `translateAndEmit` 是唯一映射点 |
| 跨服务业务逻辑 | `packages/api-gateway/src/handlers/*` | 默认模型选择、会话/空间/任务操作等，未来多端共用 |

### 4.3 长期维护规则

1. **契约唯一化**：跨进程类型只存在于 `ipc-contract`；渲染层 UI 类型从契约派生/扩展，不得声明与契约平行的同名结构。
2. **校验唯一化**：所有 IPC 入参走 Zod schema。禁止在 `ipcRouter.ts` 用 `raw as {...}` + 手动 `if (!x) throw` 做非结构化校验；新通道先补 schema 再注册。
3. **通道名常量化**：IPC 通道名集中定义为常量，`ipcMain.handle` / `ipcRenderer.invoke` / 事件名统一引用，不写裸字符串。
4. **逻辑下沉共享层**：会被多端复用的逻辑实现在 `api-gateway` handler 或共享模块；`ipcRouter.ts` 只做「校验 → 转发 → 回包」。同一段逻辑不得在主进程与渲染进程各写一遍。
5. **三处引用规则（Rule of Three）**：首次出现写到归属处；第二次复用抽到共享处；严禁出现第三份拷贝。
6. **复用优先于重写**：新代码先查 `ipc-contract` / `api-gateway` / `configStore` / `workspaceManager` / `agentRuntime`，有现成能力则 import，不重复实现。
7. **新服务接入走 Gateway**：未来 IM Bot / WebUI 必须 import `api-gateway` + `ipc-contract` 接入，禁止各自维护路由 / 校验 / 类型层。
8. **依赖方向不倒退**：任何 import 不得违反 §3 包边界表；若共享需跨错误方向，把逻辑下沉到共享包，而非让边界让步。
9. **契约变更同 PR 收敛**：修改共享类型 / schema / 通道时，其全部消费方在同一改动内完成更新，以 `npm run build` 类型检查为漂移门禁。
10. **契约演进同步文档**：`ipc-contract` 的类型 / schema / 通道变更同步更新 `docs/architecture.md` §6。

## 6. 常用命令

```bash
npm install                 # 安装依赖
npm run dev                 # 启动桌面应用（electron-forge start）
npm run build               # 类型检查所有 workspace
npm run test                # 单元测试（vitest）
npm run lint                # biome check
npm run lint:fix            # biome check --write
npm run make                # 打包桌面应用
```

## 7. git commit 规范

- 使用类型+简短描述的形式总结提交内容 如 "feat: 初始化项目工程"

## 8. 参考

- pi monorepo：https://github.com/earendil-works/pi
- pi.dev 文档：https://pi.dev/docs/latest
