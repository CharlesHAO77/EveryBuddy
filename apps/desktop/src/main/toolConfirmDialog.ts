/**
 * 工具确认弹窗（见 docs/architecture.md §5.2, §7.4）。
 *
 * 调用 Electron dialog 展示工具名、参数、影响范围，等待用户确认。
 * 工具门控拦截：write / edit / 删除类 / bash 等破坏性工具。
 */
// TODO: 实现 confirmToolCall(req) -> ToolConfirmResponse，并写审计日志
export {}; // 占位
