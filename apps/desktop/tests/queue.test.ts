/**
 * queue 排队交付纯函数单元测试。
 */

import { describe, expect, it } from "vitest";
import { buildUserBlocks, diffDeliveredFollowUps } from "../src/renderer/queue";

describe("diffDeliveredFollowUps", () => {
  it("队列不变/变长 → 0 交付", () => {
    expect(diffDeliveredFollowUps([], [])).toBe(0);
    expect(diffDeliveredFollowUps(["a"], ["a"])).toBe(0);
    expect(diffDeliveredFollowUps(["a"], ["a", "b"])).toBe(0);
  });

  it("变短 1 条 → 交付 1", () => {
    expect(diffDeliveredFollowUps(["a"], [])).toBe(1);
    expect(diffDeliveredFollowUps(["a", "b"], ["a"])).toBe(1);
  });

  it("批量交付 → 交付多条", () => {
    expect(diffDeliveredFollowUps(["a", "b", "c"], [])).toBe(3);
    expect(diffDeliveredFollowUps(["a", "b", "c"], ["c"])).toBe(2);
  });
});

describe("buildUserBlocks", () => {
  it("纯文本 → 单个 text 块", () => {
    const blocks = buildUserBlocks("稍后总结", []);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "text", content: "稍后总结", done: true });
  });

  it("纯附件 → 文件块在前、无文本块", () => {
    const blocks = buildUserBlocks("   ", [{ name: "a.ts", path: "/x/a.ts", size: 10 }]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "file", name: "a.ts", size: 10, done: true });
  });

  it("附件 + 文本 → 文件块在前、文本块在后", () => {
    const blocks = buildUserBlocks("帮我看看", [
      { name: "a.ts", path: "/x/a.ts", size: 10 },
      { name: "b.png", path: "/x/b.png", size: 20 },
    ]);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.kind).toBe("file");
    expect(blocks[1]?.kind).toBe("file");
    expect(blocks[2]).toMatchObject({ kind: "text", content: "帮我看看", done: true });
  });
});
