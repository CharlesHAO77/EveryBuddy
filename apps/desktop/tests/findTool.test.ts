/**
 * findTool（纯 Node find 兜底）单元测试——真实临时目录 + tinyglobby。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFindOperations } from "../src/main/tools/findTool";

let tmpDir: string;
let ops: ReturnType<typeof createFindOperations>;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "everybuddy-find-"));
  mkdirSync(path.join(tmpDir, "nested"));
  mkdirSync(path.join(tmpDir, "node_modules"));
  writeFileSync(path.join(tmpDir, "a.ts"), "");
  writeFileSync(path.join(tmpDir, "b.js"), "");
  writeFileSync(path.join(tmpDir, ".hidden.ts"), "");
  writeFileSync(path.join(tmpDir, "nested", "c.ts"), "");
  writeFileSync(path.join(tmpDir, "node_modules", "skip.ts"), "");
  ops = createFindOperations();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("createFindOperations", () => {
  it("glob 按模式返回绝对路径，跳过 ignore 规则，包含点文件", async () => {
    const results = await ops.glob("**/*.ts", tmpDir, {
      ignore: ["**/node_modules/**", "**/.git/**"],
      limit: 1000,
    });
    const rel = results.map((p) => path.relative(tmpDir, p).replace(/\\/g, "/")).sort();
    expect(rel).toEqual([".hidden.ts", "a.ts", "nested/c.ts"]);
  });

  it("limit 截断结果", async () => {
    const results = await ops.glob("**/*.ts", tmpDir, {
      ignore: ["**/node_modules/**", "**/.git/**"],
      limit: 1,
    });
    expect(results).toHaveLength(1);
  });

  it("exists 判断路径存在性", async () => {
    expect(await ops.exists(path.join(tmpDir, "a.ts"))).toBe(true);
    expect(await ops.exists(path.join(tmpDir, "nope.ts"))).toBe(false);
  });
});
