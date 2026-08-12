/**
 * historyMapper 单元测试：完整路径重建 + 压缩边界提示 + 工具结果回填。
 * 纯函数测试，构造合成 SessionEntry，不触碰真实 ~/EveryBuddy。
 */
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { buildFullPath, entriesToHistory, type FullPathProvider } from "../src/main/historyMapper";

interface EntryLike {
  type: string;
  id: string;
  parentId?: string;
  timestamp: string;
  message?: unknown;
  summary?: string;
  firstKeptEntryId?: string;
}

/** 构造一条 message 条目 */
function msg(id: string, parentId: string, message: unknown): EntryLike {
  return { type: "message", id, parentId, timestamp: "2026-08-01T00:00:00.000Z", message };
}

/** 构造一条 compaction 条目 */
function compaction(
  id: string,
  parentId: string,
  firstKeptEntryId: string,
  summary: string,
): EntryLike {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp: "2026-08-01T01:00:00.000Z",
    firstKeptEntryId,
    summary,
  };
}

const userMsg = (text: string) => ({ role: "user", content: text });
const assistantMsg = (blocks: unknown[]) => ({ role: "assistant", content: blocks });
const toolResultMsg = (toolCallId: string, output: unknown) => ({
  role: "toolResult",
  toolCallId,
  content: output,
});

/** 构造沿 parentId 成链的合成 entries（与 SDK 文件结构一致） */
function chain(entries: EntryLike[]): SessionEntry[] {
  return entries.map((e) => e as unknown as SessionEntry);
}

/** 最小 FullPathProvider stub：getBranch 沿 parentId 从指定 id 走到根 */
function makeSm(entries: SessionEntry[], leafId?: string | null): FullPathProvider {
  const byId = new Map(entries.map((e) => [e.id, e]));
  return {
    getLeafId: () => leafId ?? entries[entries.length - 1]?.id ?? null,
    getBranch: (fromId?: string) => {
      const path: SessionEntry[] = [];
      let cur = fromId ? byId.get(fromId) : byId.get(entries[entries.length - 1]?.id ?? "");
      while (cur) {
        path.push(cur);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
      path.reverse();
      return path;
    },
  };
}

describe("entriesToHistory", () => {
  it("压缩会话：保留全部消息，并在压缩边界（保留的第一条前）插入 notice", () => {
    const entries = chain([
      msg("u1", "root", userMsg("帮我做 PPT")),
      msg(
        "a1",
        "u1",
        assistantMsg([
          { type: "text", text: "好的" },
          { type: "toolCall", id: "tc1", name: "gen" },
        ]),
      ),
      msg("tr1", "a1", toolResultMsg("tc1", "生成完成")),
      compaction("c1", "tr1", "u2", "## 已压缩\n- 早期内容"),
      msg("u2", "c1", userMsg("继续")),
      msg("a2", "u2", assistantMsg([{ type: "text", text: "继续推进" }])),
    ]);

    const result = entriesToHistory(entries, { compactionNotices: true });

    // 全部 4 条 message 都在（无丢弃），外加 1 条 notice
    expect(result).toHaveLength(5);
    expect(result.map((m) => m.role)).toEqual(["user", "assistant", "notice", "user", "assistant"]);
    // 工具结果回填到 assistant 的工具块
    const a1 = result[1];
    if (a1?.role !== "assistant") throw new Error("a1 缺失");
    const tool = a1.blocks.find((b) => b.kind === "tool");
    expect(tool?.kind === "tool" && tool.output).toBe("生成完成");
    // notice 位于保留的第一条 u2 之前，内容为压缩摘要
    const notice = result[2];
    expect(notice?.role).toBe("notice");
    if (!notice) throw new Error("notice 缺失");
    expect(notice.noticeContent).toBe("## 已压缩\n- 早期内容");
  });

  it("无 compaction：不产生 notice，全部消息原样映射", () => {
    const entries = chain([
      msg("u1", "root", userMsg("你好")),
      msg("a1", "u1", assistantMsg([{ type: "text", text: "你好！" }])),
    ]);
    const result = entriesToHistory(entries, { compactionNotices: true });
    expect(result).toHaveLength(2);
    expect(result.some((m) => m.role === "notice")).toBe(false);
    expect(result[1]?.blocks[0]?.kind === "text" && result[1].blocks[0].content).toBe("你好！");
  });

  it("compactionNotices 默认关闭时不插 notice", () => {
    const entries = chain([
      msg("u1", "root", userMsg("a")),
      compaction("c1", "u1", "u2", "摘要"),
      msg("u2", "c1", userMsg("b")),
    ]);
    const result = entriesToHistory(entries);
    expect(result.some((m) => m.role === "notice")).toBe(false);
    expect(result).toHaveLength(2);
  });

  it("firstKeptEntryId 找不到时不崩溃、无 notice", () => {
    const entries = chain([
      msg("u1", "root", userMsg("a")),
      compaction("c1", "u1", "ghost-id", "摘要"),
      msg("u2", "c1", userMsg("b")),
    ]);
    const result = entriesToHistory(entries, { compactionNotices: true });
    expect(result).toHaveLength(2);
    expect(result.some((m) => m.role === "notice")).toBe(false);
  });

  it("边界在路径开头（无丢弃内容）时不产生 notice", () => {
    const entries = chain([compaction("c1", "root", "u1", "摘要"), msg("u1", "c1", userMsg("a"))]);
    const result = entriesToHistory(entries, { compactionNotices: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe("user");
  });

  it("工具结果 isError 时错误文本回填到工具块", () => {
    const entries = chain([
      msg("a1", "root", assistantMsg([{ type: "toolCall", id: "tc1", name: "run" }])),
      msg("tr1", "a1", { ...toolResultMsg("tc1", "失败原因"), isError: true }),
    ]);
    const result = entriesToHistory(entries, { compactionNotices: true });
    const a1 = result[0];
    if (a1?.role !== "assistant") throw new Error("a1 缺失");
    const tool = a1.blocks.find((b) => b.kind === "tool");
    if (tool?.kind !== "tool") throw new Error("tool 块缺失");
    expect(tool.status).toBe("error");
    expect(tool.error).toBe("失败原因");
  });
});

describe("buildFullPath", () => {
  it("从叶子沿 parentId 走完整路径（含非 message 条目）", () => {
    const entries = chain([
      msg("u1", "root", userMsg("a")),
      msg("a1", "u1", assistantMsg([{ type: "text", text: "b" }])),
      compaction("c1", "a1", "u2", "摘要"),
      msg("u2", "c1", userMsg("c")),
    ]);
    const path = buildFullPath(makeSm(entries, "u2"));
    // 从叶子沿 parentId 走到链头（root 不在 entries 中，链在 u1 处结束）
    expect(path.map((e) => e.id)).toEqual(["u1", "a1", "c1", "u2"]);
    // 含 compaction 条目
    expect(path.some((e) => e.type === "compaction")).toBe(true);
  });

  it("空会话返回空路径", () => {
    expect(buildFullPath(makeSm([], null))).toEqual([]);
  });
});
