/**
 * billing 聚合纯函数单元测试——真实 usage 按模型类型分账。
 */

import type { ModelProviderConfig } from "@everybuddy/ipc-contract";
import { describe, expect, it } from "vitest";
import {
  aggregateBilling,
  formatCost,
  formatTokens,
  resolveMessageModel,
  sumBillingRows,
} from "../src/renderer/billing";
import type { ChatMessage } from "../src/renderer/stores/sessionStore";

const MODELS: ModelProviderConfig[] = [
  {
    id: "p-llm",
    name: "对话模型",
    baseUrl: "https://x",
    model: "claude-sonnet-5",
    isOpenAiCompatible: true,
    hasApiKey: true,
    capabilities: { vision: false, imageGen: false },
    type: "llm",
    active: true,
  },
  {
    id: "p-vlm",
    name: "视觉模型",
    baseUrl: "https://x",
    model: "doubao-vision",
    isOpenAiCompatible: true,
    hasApiKey: true,
    capabilities: { vision: true, imageGen: false },
    type: "vlm",
    active: false,
  },
  {
    id: "p-img",
    name: "生图模型",
    baseUrl: "https://x",
    model: "seedream",
    isOpenAiCompatible: true,
    hasApiKey: true,
    capabilities: { vision: false, imageGen: true },
    type: "image",
    active: false,
  },
];

function mkMsg(
  over: Partial<ChatMessage> & { usage: NonNullable<ChatMessage["usage"]> },
): ChatMessage {
  return {
    id: "m",
    role: "assistant",
    blocks: [],
    timestamp: 0,
    ...over,
  };
}

describe("resolveMessageModel", () => {
  it("消息级 provider 命中配置 → 类型 + 模型 id", () => {
    const r = resolveMessageModel("p-llm", undefined, MODELS);
    expect(r.type).toBe("llm");
    expect(r.model).toBe("claude-sonnet-5");
  });

  it("消息级 model 优先于配置 model", () => {
    const r = resolveMessageModel("p-llm", "op4", MODELS);
    expect(r.model).toBe("op4");
    expect(r.type).toBe("llm");
  });

  it("provider 缺失时按模型 id 反查类型", () => {
    const r = resolveMessageModel(undefined, "doubao-vision", MODELS);
    expect(r.type).toBe("vlm");
  });

  it("均无法解析 → type 为 undefined", () => {
    const r = resolveMessageModel(undefined, "unknown-model", MODELS);
    expect(r.type).toBeUndefined();
  });
});

describe("aggregateBilling", () => {
  it("按类型分组求和 input/output/cacheRead/totalTokens/cost 与条数", () => {
    const messages = [
      mkMsg({
        provider: "p-llm",
        usage: {
          input: 100,
          output: 200,
          cacheRead: 50,
          cacheWrite: 0,
          totalTokens: 350,
          cost: { input: 0.1, output: 0.2, total: 0.3 },
        },
      }),
      mkMsg({
        provider: "p-llm",
        usage: {
          input: 300,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 400,
          cost: { input: 0.3, output: 0.1, total: 0.4 },
        },
      }),
      mkMsg({
        provider: "p-img",
        usage: {
          input: 50,
          output: 1024,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1074,
          cost: { input: 0.01, output: 0.04, total: 0.05 },
        },
      }),
    ];
    const rows = aggregateBilling(messages, MODELS);
    expect(rows).toHaveLength(2);

    const llm = rows.find((r) => r.type === "llm");
    expect(llm?.count).toBe(2);
    expect(llm?.usage.input).toBe(400);
    expect(llm?.usage.output).toBe(300);
    expect(llm?.usage.cacheRead).toBe(50);
    expect(llm?.usage.totalTokens).toBe(750);
    expect(llm?.usage.cost).toBeCloseTo(0.7, 5);

    const img = rows.find((r) => r.type === "image");
    expect(img?.count).toBe(1);
    expect(img?.usage.totalTokens).toBe(1074);
    expect(img?.usage.cost).toBeCloseTo(0.05, 5);
  });

  it("无 usage 或类型不可解析的消息跳过", () => {
    const messages: ChatMessage[] = [
      mkMsg({
        provider: "p-llm",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      }),
      { id: "u", role: "user", blocks: [], timestamp: 0 },
      mkMsg({
        provider: "unknown",
        usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
      }),
    ];
    const rows = aggregateBilling(messages, MODELS);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.usage.totalTokens).toBe(2);
  });

  it("空消息 → 空数组", () => {
    expect(aggregateBilling([], MODELS)).toEqual([]);
  });
});

describe("formatTokens / formatCost", () => {
  it("千以上缩写，其余整数", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1200)).toBe("1.2k");
    expect(formatTokens(2000)).toBe("2k");
  });

  it("费用分档精度", () => {
    expect(formatCost(0)).toBe("¥0");
    expect(formatCost(0.005)).toBe("¥0.005");
    expect(formatCost(0.0005)).toBe("¥0.0005");
    expect(formatCost(0.12345)).toBe("¥0.123");
  });
});

describe("sumBillingRows", () => {
  it("空 → 0", () => {
    expect(sumBillingRows([])).toEqual({ totalTokens: 0, cost: 0 });
  });

  it("单行累加", () => {
    const rows = aggregateBilling(
      [
        mkMsg({
          provider: "p-llm",
          usage: {
            input: 100,
            output: 200,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 300,
            cost: { input: 0.1, output: 0.2, total: 0.3 },
          },
        }),
      ],
      MODELS,
    );
    expect(sumBillingRows(rows)).toEqual({ totalTokens: 300, cost: 0.3 });
  });

  it("多行跨类型累加（本条 run 与整会话口径一致）", () => {
    // 本条 run：2 条 llm
    const runMsgs = [
      mkMsg({
        provider: "p-llm",
        usage: {
          input: 100,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 200,
          cost: { total: 0.1 },
        },
      }),
      mkMsg({
        provider: "p-llm",
        usage: {
          input: 200,
          output: 200,
          cacheRead: 50,
          cacheWrite: 0,
          totalTokens: 450,
          cost: { total: 0.2 },
        },
      }),
    ];
    const runRows = aggregateBilling(runMsgs, MODELS);
    const runSum = sumBillingRows(runRows);
    expect(runSum.totalTokens).toBe(650);
    expect(runSum.cost).toBeCloseTo(0.3, 5);

    // 整会话：加上一条 img —— 会话累计应大于本条 run
    const sessionMsgs = [
      ...runMsgs,
      mkMsg({
        provider: "p-img",
        usage: {
          input: 50,
          output: 1024,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1074,
          cost: { total: 0.05 },
        },
      }),
    ];
    const sessionRows = aggregateBilling(sessionMsgs, MODELS);
    const sessionSum = sumBillingRows(sessionRows);
    expect(sessionSum.totalTokens).toBe(650 + 1074);
    expect(sessionSum.cost).toBeCloseTo(0.35, 5);
  });
});
