# Plan Mode Extension（桌面适配版）

只读探索模式，用于安全的代码分析。桌面端无 TUI，触发与状态展示经 IPC 完成。

## 特性

- **内置写入工具禁用**：启用后禁用 edit/write，保留其余激活工具
- **Bash 白名单**：只允许只读 bash 命令（见 `utils.ts` 的 `isSafeCommand`）
- **计划提取**：从 `Plan:` 段落提取编号步骤
- **进度追踪**：执行中按 `[DONE:n]` 标记更新完成状态
- **会话持久化**：状态经 `appendEntry` 写入会话，resume 时还原

## 触发与展示（桌面 UI）

- **切换**：渲染进程点击输入栏「计划模式」按钮 → `agent:extension-command { extension: "plan-mode", command: "toggle" }` → 控制器 `toggle()`
- **执行**：状态条显示步骤清单 + 「执行计划」按钮（`state === "ready"` 时出现）→ 控制器 `execute()`
- **状态推送**：`extension_status`（`state: off | plan | ready | executing`，含 `value`/`lines`）与 `extension_notify` 经 IPC 推送到渲染进程

## 使用

1. 在 coding 任务输入栏开启计划模式（只读探索）
2. 让 agent 分析代码并给出编号计划（`Plan:` 标题下）
3. agent 产出计划后，状态条显示步骤，「执行计划」按钮可用
4. 执行中 agent 每完成一步在回复中带 `[DONE:n]` 标记，进度自动更新
5. 全部完成自动清空并推送「计划完成」消息

## 实现说明

- 行为钩子（`pi.on` session_start/tool_call/context/before_agent_start/turn_end/agent_end、`setActiveTools`、`appendEntry`）保留自 pi TUI 版
- TUI 的 `ctx.ui.*` 改为 `emit`（`Emit` 类型，见 `../types.ts`）；`registerShortcut`/`registerCommand` 移除，触发走控制器侧信道
- `execute()` 经 `pi.sendMessage({ customType: "plan-mode-execute" }, { triggerTurn: true })` 发起执行

### Bash 命令白名单（与 pi 一致）

放行：文件查看 `cat/head/tail/less/more`、搜索 `grep/find/rg/fd`、目录 `ls/pwd/tree`、git 只读 `status/log/diff/branch`、包信息 `npm list/outdated`、系统信息 `uname/whoami/date/uptime`

拦截：文件修改 `rm/mv/cp/mkdir/touch`、git 写操作 `add/commit/push`、包安装 `npm install/yarn add/pip install`、系统 `sudo/kill/reboot`、编辑器 `vim/nano/code`
