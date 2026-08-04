/**
 * 原生 API Key 输入对话框（见 docs/architecture.md §5.2, §7.3）。
 *
 * 流程：用户点击「配置 API Key」-> 渲染进程触发 config:openApiKeyDialog
 * -> 主进程弹出 Electron 原生输入框 -> 用户输入密钥
 * -> 主进程调用 AuthStorage.set() 存储 -> 对话框关闭。
 *
 * 安全关键：密钥不经过渲染进程、不落地明文。
 */
// TODO: 实现 openApiKeyDialog(provider)，委托 AuthStorage 存储
export {}; // 占位
