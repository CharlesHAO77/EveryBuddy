import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // tests/e2e 归 Playwright（npm run test:e2e），vitest 只收集单元测试
    exclude: ["**/node_modules/**", "**/dist/**", "**/.vite/**", "apps/desktop/tests/e2e/**"],
  },
});
