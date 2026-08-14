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
      "@everybuddy/api-gateway": path.resolve(__dirname, "../../packages/api-gateway/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      // pi-coding-agent / pi-ai 是 ESM-only 且带 WASM 依赖，不做 bundle；
      // 附件解析库（unpdf/mammoth/xlsx/jszip）与 typebox 同样外部化，
      // 运行时在 agentRuntime.ts / fileParser.ts 中通过动态 import() 加载
      // （Node 22 原生支持 CJS 中 import ESM）。
      external: [
        "electron",
        "electron-store",
        "unpdf",
        "mammoth",
        "xlsx",
        "jszip",
        "typebox",
        ...builtinModules,
        /^@earendil-works\//,
        /^@modelcontextprotocol\//,
      ],
      output: {
        entryFileNames: "main.js",
      },
    },
  },
});
