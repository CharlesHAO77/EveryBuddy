/**
 * findTool - 纯 Node 实现的 find 兜底（fd 缺失时的降级后端）。
 *
 * SDK 内置 find 硬依赖外部 fd 二进制（首次使用从 GitHub 自动下载，
 * 见 node_modules/.../dist/core/tools/find.js ensureTool("fd")）。SDK 的
 * createFindToolDefinition(cwd, { operations }) 原生支持自定义 glob 操作走纯
 * Node 路径（find.js 的 customOps.glob 分支），本文件只提供该 FindOperations。
 * 由 agentRuntime 用 createFindToolDefinition 包装后经 customTools 覆盖内置。
 */

import { stat } from "node:fs/promises";
import type { FindOperations } from "@earendil-works/pi-coding-agent";
import { glob } from "tinyglobby";

/** find 兜底：纯 Node glob 操作（对齐 FindOperations） */
export function createFindOperations(): FindOperations {
  return {
    exists: async (p) => {
      try {
        await stat(p);
        return true;
      } catch {
        return false;
      }
    },
    glob: async (pattern, cwd, { ignore, limit }) =>
      (
        await glob(pattern, {
          cwd,
          ignore,
          dot: true,
          absolute: true,
          onlyFiles: true,
        })
      ).slice(0, limit),
  };
}
