/**
 * slashCommands 纯函数单元测试。
 */
import { describe, expect, it } from "vitest";
import { filterSlashCommands, matchSlash } from "../src/renderer/slashCommands";

describe("matchSlash", () => {
  it("匹配 /keyword（含 trim 与空关键字）", () => {
    expect(matchSlash("/plan")).toBe("plan");
    expect(matchSlash("/plan ")).toBe("plan");
    expect(matchSlash("/")).toBe("");
  });

  it("非 / 开头或含空格/其它字符返回 null", () => {
    expect(matchSlash("plan")).toBe(null);
    expect(matchSlash("/plan foo")).toBe(null);
    expect(matchSlash("")).toBe(null);
    expect(matchSlash("你好")).toBe(null);
    expect(matchSlash("a/plan")).toBe(null);
  });
});

describe("filterSlashCommands", () => {
  const ctx = { taskId: "t1", mode: "coding" as const };

  it("空关键字返回全部可用命令", () => {
    const all = filterSlashCommands("", ctx);
    expect(all.map((c) => c.id)).toContain("plan");
  });

  it("按关键字过滤", () => {
    expect(filterSlashCommands("plan", ctx)[0]?.id).toBe("plan");
    expect(filterSlashCommands("PLAN", ctx)[0]?.id).toBe("plan");
    expect(filterSlashCommands("zzz", ctx)).toHaveLength(0);
  });

  it("欢迎页无任务时 plan 仍可用（切换 pendingMode）", () => {
    const items = filterSlashCommands("", { taskId: null, mode: null });
    expect(items.map((c) => c.id)).toContain("plan");
  });
});
