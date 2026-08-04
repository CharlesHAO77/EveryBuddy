import path from "node:path";
import { defineConfig } from "vite";

/**
 * Preload Vite 配置（见 docs/architecture.md §6.3, §7.1）。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@everybuddy/ipc-contract": path.resolve(
        __dirname,
        "../../packages/ipc-contract/src/index.ts",
      ),
    },
  },
  build: {
    rollupOptions: {
      external: ["electron"],
    },
  },
});
