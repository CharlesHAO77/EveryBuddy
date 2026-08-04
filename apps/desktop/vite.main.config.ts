import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";

/**
 * 主进程 Vite 配置（见 docs/architecture.md §11.2）。
 * 通过 alias 将共享包解析到源码；electron / Node 内建 / 原生依赖外部化。
 */
export default defineConfig({
  resolve: {
    alias: {
      "@everybuddy/ipc-contract": path.resolve(
        __dirname,
        "../../packages/ipc-contract/src/index.ts",
      ),
      "@everybuddy/api-gateway": path.resolve(
        __dirname,
        "../../packages/api-gateway/src/index.ts",
      ),
    },
  },
  build: {
    rollupOptions: {
      external: ["electron", "electron-store", ...builtinModules],
      output: {
        entryFileNames: "main.js",
      },
    },
  },
});
