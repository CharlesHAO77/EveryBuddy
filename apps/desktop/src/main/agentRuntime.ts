/**
 * AgentRuntime - pi-coding-agent 运行时封装层（见 docs/architecture.md §5.1）。
 *
 * 职责：
 * 1. 初始化并管理 pi-coding-agent 实例，复用其 TUI / SessionManager / AuthStorage。
 * 2. 将 pi-coding-agent 事件转换为统一 AgentEvent 供渲染进程消费。
 * 3. 拦截破坏性工具，调用 toolConfirmDialog 请求用户确认。
 * 4. 会话持久化（JSONL tree）。
 * 5. 通过 API Gateway 暴露统一接口。
 *
 * @see docs/architecture.md §5.1, §7.3, §7.4
 */
// TODO: 接入 @earendil-works/pi-coding-agent 后实现（先补齐依赖，见 agents.md §8）
export {}; // 占位
