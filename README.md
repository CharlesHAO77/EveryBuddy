# everyBuddy

面向开发者的本地桌面 AI 助手，基于 Electron + React 构建，核心 agent 能力由 [`@earendil-works/pi-coding-agent`](https://github.com/earendil-works/pi) 提供。

- 需求文档：[`docs/requirements.md`](docs/requirements.md)
- 架构设计：[`docs/architecture.md`](docs/architecture.md)
- 协作指南：[`agents.md`](agents.md)

## 状态

脚手架阶段：目录结构、包边界、构建与代码规范配置已就位，尚无业务逻辑实现。

## 常用命令

```bash
npm install      # 安装依赖
npm run dev      # 启动桌面应用
npm run build    # 类型检查所有 workspace
npm run test     # 单元测试
npm run lint     # Biome 检查
npm run make     # 打包桌面应用
```

## 结构

```
packages/
  ipc-contract/   # IPC 类型契约 + Zod schema
  api-gateway/    # 统一请求路由抽象层
apps/
  desktop/        # Electron + React 桌面应用（MVP）
```

详见 [`agents.md`](agents.md)。
