/**
 * slashCommands 纯函数单元测试。
 */
import { describe, expect, it } from "vitest";
import {
  filterSlashCommands,
  isBareSteerCommand,
  matchSlash,
  parseCommandChannel,
} from "../src/renderer/slashCommands";

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
    expect(all.map((c) => c.id)).toContain("steer");
    expect(all.map((c) => c.id)).toContain("follow-up");
  });

  it("steer/follow-up 为扩展命令（insertPrefix）", () => {
    const steer = filterSlashCommands("steer", ctx)[0];
    expect(steer?.insertPrefix).toBe("/steer ");
    const follow = filterSlashCommands("follow", ctx)[0];
    expect(follow?.insertPrefix).toBe("/follow-up ");
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

describe("parseCommandChannel", () => {
  it("解析 /steer 内容 → steer 通道 + 剥离前缀", () => {
    expect(parseCommandChannel("/steer 换个思路")).toEqual({
      channel: "steer",
      rest: "换个思路",
    });
  });

  it("解析 /follow-up 内容 → followUp 通道", () => {
    expect(parseCommandChannel("/follow-up 稍后处理这个")).toEqual({
      channel: "followUp",
      rest: "稍后处理这个",
    });
  });

  it("内容含多行 / 首尾空格时保留", () => {
    const r = parseCommandChannel("  /steer  第一行\n第二行  ");
    expect(r?.channel).toBe("steer");
    expect(r?.rest).toBe("第一行\n第二行");
  });

  it("普通文本 / 其它命令 / 裸命令返回 null", () => {
    expect(parseCommandChannel("你好")).toBeNull();
    expect(parseCommandChannel("/plan foo")).toBeNull();
    expect(parseCommandChannel("/steer")).toBeNull();
    expect(parseCommandChannel("/follow-up  ")).toBeNull();
  });
});

describe("isBareSteerCommand", () => {
  it("裸 /steer /follow-up（含空格）为真", () => {
    expect(isBareSteerCommand("/steer")).toBe(true);
    expect(isBareSteerCommand("/steer ")).toBe(true);
    expect(isBareSteerCommand("/follow-up")).toBe(true);
  });

  it("带参数或普通文本为假", () => {
    expect(isBareSteerCommand("/steer 内容")).toBe(false);
    expect(isBareSteerCommand("/plan")).toBe(false);
    expect(isBareSteerCommand("你好")).toBe(false);
  });
});
