/**
 * grepTool（纯 Node grep）单元测试——真实临时目录 + tinyglobby。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGrepSearch } from "../src/main/tools/grepTool";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "everybuddy-grep-"));
  mkdirSync(path.join(tmpDir, "nested"));
  mkdirSync(path.join(tmpDir, "node_modules"));
  writeFileSync(path.join(tmpDir, "a.ts"), "hello foo\nsecond line\n");
  writeFileSync(path.join(tmpDir, "b.js"), "foo in js\n");
  writeFileSync(path.join(tmpDir, "nested", "c.ts"), "foo in nested\n");
  writeFileSync(path.join(tmpDir, "node_modules", "skip.ts"), "foo in node_modules\n");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runGrepSearch", () => {
  it("基本匹配：按行返回 文件:行号:内容，跳过 node_modules", async () => {
    const result = await runGrepSearch(tmpDir, { pattern: "foo" });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("a.ts:1:hello foo");
    expect(text).toContain("b.js:1:foo in js");
    expect(text).toContain("nested/c.ts:1:foo in nested");
    expect(text).not.toContain("node_modules");
  });

  it("ignoreCase 生效", async () => {
    const result = await runGrepSearch(tmpDir, { pattern: "HELLO", ignoreCase: true });
    expect(result.content[0]?.text).toContain("a.ts:1:hello foo");
  });

  it("literal 模式把模式当作字面量（h.llo 不匹配 hello）", async () => {
    const literal = await runGrepSearch(tmpDir, { pattern: "h.llo", literal: true });
    expect(literal.content[0]?.text).toBe("No matches found");

    const regex = await runGrepSearch(tmpDir, { pattern: "h.llo" });
    expect(regex.content[0]?.text).toContain("a.ts:1:hello foo");
  });

  it("glob 过滤文件", async () => {
    const result = await runGrepSearch(tmpDir, { pattern: "foo", glob: "*.js" });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("b.js:1:foo in js");
    expect(text).not.toContain("a.ts");
  });

  it("context 附带前后行", async () => {
    const file = path.join(tmpDir, "ctx.txt");
    writeFileSync(file, "l1\nl2\nfoo\nl4\nl5\n");
    const result = await runGrepSearch(tmpDir, { pattern: "foo", path: "ctx.txt", context: 1 });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("ctx.txt-2-l2");
    expect(text).toContain("ctx.txt:3:foo");
    expect(text).toContain("ctx.txt-4-l4");
  });

  it("limit 截断匹配数", async () => {
    const file = path.join(tmpDir, "many.txt");
    writeFileSync(file, Array.from({ length: 10 }, (_, i) => `line ${i} foo`).join("\n"));
    const result = await runGrepSearch(tmpDir, { pattern: "foo", path: "many.txt", limit: 3 });
    const lines = (result.content[0]?.text ?? "").split("\n").filter(Boolean);
    expect(lines).toHaveLength(3);
  });

  it("path 指向单文件：仅搜该文件", async () => {
    const result = await runGrepSearch(tmpDir, { pattern: "foo", path: "nested/c.ts" });
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("c.ts:1:foo in nested");
    expect(text).not.toContain("a.ts");
  });

  it("无匹配返回提示", async () => {
    const result = await runGrepSearch(tmpDir, { pattern: "zzz_not_exists" });
    expect(result.content[0]?.text).toBe("No matches found");
  });

  it("无效正则返回错误提示", async () => {
    const result = await runGrepSearch(tmpDir, { pattern: "[" });
    expect(result.content[0]?.text).toContain("Invalid regex");
  });
});
