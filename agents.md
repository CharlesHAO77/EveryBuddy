# agents.md — everyBuddy 仓库协作指南

> 本文件面向在本仓库中工作的 AI 编程助手与人类开发者。任何改动前请先读本文件与 `docs/architecture.md`。

## 1. 项目简介

**everyBuddy** 是一款面向开发者的本地桌面 AI 助手（Electron + React），核心 agent 能力由 `@earendil-works/pi-coding-agent` 提供。MVP 仅交付桌面端，架构为未来 IM Bot / WebUI 预留接入点。

- PRD：`docs/requirements.md`
- 架构：`docs/architecture.md`

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
|----|----------|--------|------|
| `@everybuddy/ipc-contract` | 任意 | `zod` | 任何运行时逻辑、Electron/Node API |
| `@everybuddy/api-gateway` | 主进程 / 未来 bot-server | `ipc-contract` | Electron、React、渲染进程 |
| `@everybuddy/desktop`（main） | — | `ipc-contract`、`api-gateway`、`electron`、`pi-coding-agent` | — |
| `@everybuddy/desktop`（renderer） | — | `ipc-contract`（仅类型）、React、Zustand | `electron`、`api-gateway`、任何 Node API |

**铁律**：渲染进程不直接 import `electron` 或 `api-gateway`；与主进程的唯一通道是 `window.electronAPI`（由 preload 暴露）。

## 4. 编码规范

- TypeScript 严格模式（`strict`、`noUncheckedIndexedAccess`），见 `tsconfig.base.json`。
- 格式化与 lint：Biome（`biome.json`），双引号、分号、尾逗号、2 空格、行宽 100。
- 命名：文件 `camelCase.ts`，组件 `PascalCase.tsx`，类型/接口 `PascalCase`。
- 共享包为 ESM（`"type": "module"`）；desktop 主进程为 CJS（兼容 Electron Forge）。
- 共享包**以源码导出**（`exports.types/default` 指向 `src/index.ts`），desktop 通过 Vite alias 解析到源码——MVP 阶段无需预编译共享包。
- 类型导入优先用 `import type`。

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

## 8. 实现路线（建议顺序）

1. `packages/ipc-contract`：补全类型 + Zod schema（对齐 `docs/architecture.md` §6）。
2. `apps/desktop/src/main`：`app.ts` → `windowManager.ts` → `ipcRouter.ts`（注册通道 + 校验）→ `preload/index.ts`。
3. 接入 `pi-coding-agent`：`agentRuntime.ts` + `configStore.ts` + `apiKeyDialog.ts`。
4. `packages/api-gateway` + `apiGatewayBridge.ts`：统一路由。
5. `toolConfirmDialog.ts` + 工具门控 + 工作区沙箱。
6. 渲染进程 UI：`Onboarding` → `ChatView` + `SessionSidebar` → `SettingsPanel`，配 `useAgentStream` / `sessionStore`。
7. `tests/e2e/smoke.spec.ts` 冒烟测试。

## 9. 参考

- pi monorepo：https://github.com/earendil-works/pi
- pi.dev 文档：https://pi.dev/docs/latest
