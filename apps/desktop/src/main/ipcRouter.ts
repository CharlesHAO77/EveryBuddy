/**
 * IPC channel 注册、Zod 校验、错误统一处理（见 docs/architecture.md §5.2, §6, §7.2）。
 *
 * 命名空间：agent:* / session:* / config:* / system:*
 * 所有入参经 Zod schema 校验；主进程不信任渲染进程任何输入。
 */
// TODO: 注册所有 IPC 通道并接入 Zod 校验（schema 见 @everybuddy/ipc-contract）
export {}; // 占位
