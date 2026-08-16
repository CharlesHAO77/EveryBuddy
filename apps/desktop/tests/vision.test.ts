/**
 * vision 原语单元测试——fake modelRuntime，断言发送的 context 形状与返回值。
 */
import { describe, expect, it } from "vitest";
import { type DescribeImageRuntime, describeImage, extractTextContent } from "../src/main/services/vision";

function fakeRuntime(resultContent: unknown): DescribeImageRuntime & {
  calls: Array<{ model: unknown; context: unknown }>;
} {
  const calls: Array<{ model: unknown; context: unknown }> = [];
  const runtime: DescribeImageRuntime = {
    async complete(model, context) {
      calls.push({ model, context });
      return { content: resultContent };
    },
  };
  return Object.assign(runtime, { calls });
}

describe("describeImage", () => {
  it("返回视觉模型文本结果", async () => {
    const runtime = fakeRuntime([{ type: "text", text: "这是一张柱状图" }]);
    const text = await describeImage(
      runtime,
      { input: ["text", "image"] },
      {
        data: "aGVsbG8=",
        mimeType: "image/png",
      },
    );
    expect(text).toBe("这是一张柱状图");
  });

  it("发送 text + image 用户消息块（含问题）", async () => {
    const runtime = fakeRuntime({ content: "answer" });
    await describeImage(
      runtime,
      { input: ["text", "image"] },
      { data: "aGVsbG8=", mimeType: "image/png" },
      "图表里的峰值是多少？",
    );
    const ctx = runtime.calls[0]!.context as {
      systemPrompt?: string;
      messages: Array<{ role: string; content: Array<Record<string, unknown>> }>;
    };
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0]!.role).toBe("user");
    const blocks = ctx.messages[0]!.content;
    expect(blocks[0]).toMatchObject({ type: "text", text: "图表里的峰值是多少？" });
    expect(blocks[1]).toMatchObject({ type: "image", data: "aGVsbG8=", mimeType: "image/png" });
    expect(ctx.systemPrompt).toContain("视觉理解");
  });

  it("缺省问题使用默认描述提示", async () => {
    const runtime = fakeRuntime({ content: "x" });
    await describeImage(
      runtime,
      { input: ["text", "image"] },
      { data: "aA==", mimeType: "image/png" },
    );
    const ctx = runtime.calls[0]!.context as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    expect(ctx.messages[0]!.content[0]!.text).toContain("描述这张图片");
  });

  it("空返回 → 兜底提示", async () => {
    const runtime = fakeRuntime("");
    const text = await describeImage(
      runtime,
      { input: ["text", "image"] },
      {
        data: "aA==",
        mimeType: "image/png",
      },
    );
    expect(text).toContain("未返回文本");
  });

  it("abort 信号透传给 modelRuntime.complete", async () => {
    let received: { signal?: AbortSignal } | undefined;
    const runtime: DescribeImageRuntime = {
      async complete(_model, _context, options) {
        received = options;
        return { content: "x" };
      },
    };
    const ctrl = new AbortController();
    await describeImage(
      runtime,
      { input: ["text", "image"] },
      { data: "aA==", mimeType: "image/png" },
      undefined,
      ctrl.signal,
    );
    expect(received?.signal).toBe(ctrl.signal);
  });

  it("无 signal 时不传 options（complete 第三参为 undefined）", async () => {
    let received: unknown = "sentinel";
    const runtime: DescribeImageRuntime = {
      async complete(_model, _context, options) {
        received = options;
        return { content: "x" };
      },
    };
    await describeImage(runtime, { input: ["text", "image"] }, { data: "aA==", mimeType: "image/png" });
    expect(received).toBeUndefined();
  });
});

describe("extractTextContent", () => {
  it("拼接内容块数组的文本", () => {
    expect(
      extractTextContent([
        { type: "text", text: "a" },
        { type: "text", text: "b" },
        { type: "thinking", thinking: "思考" },
      ]),
    ).toBe("ab");
  });

  it("直接字符串原样返回", () => {
    expect(extractTextContent("hi")).toBe("hi");
  });

  it("非文本/空 → 空串", () => {
    expect(extractTextContent(undefined)).toBe("");
    expect(extractTextContent([{ type: "thinking", thinking: "x" }])).toBe("");
  });
});
