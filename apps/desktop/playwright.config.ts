import { defineConfig } from "@playwright/test";

/**
 * Playwright 配置 - Electron E2E（见 docs/architecture.md §3）。
 * Electron 测试通过 _electron.launch 启动打包产物，复用浏览器测试断言 API。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30000,
  // TODO: 配置 CI 产物输出目录
});
