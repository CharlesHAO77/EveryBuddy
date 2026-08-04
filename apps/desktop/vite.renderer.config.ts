import path from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * 渲染进程 Vite 配置（见 docs/architecture.md §5.3）。
 * 仅解析 ipc-contract（类型用）；禁止引入 electron / api-gateway。
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@everybuddy/ipc-contract": path.resolve(
        __dirname,
        "../../packages/ipc-contract/src/index.ts",
      ),
    },
  },
});
