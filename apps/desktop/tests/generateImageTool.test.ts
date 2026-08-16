/**
 * generateImageTool 单元测试——临时 cwd + fake deps/fetch。
 */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FetchLike } from "../src/main/services/imageGeneration";
import {
  createGenerateImageToolDefinition,
  type ImageGenProviderRef,
} from "../src/main/tools/generateImageTool";

const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function jsonResp(json: unknown): Awaited<ReturnType<FetchLike>> {
  return {
    ok: true,
    status: 200,
    text: async () => "",
    json: async () => json,
    arrayBuffer: async () => new Uint8Array(),
  } as Awaited<ReturnType<FetchLike>>;
}

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "eb-generate-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const PROVIDER: ImageGenProviderRef = {
  providerId: "g1",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  model: "seedream-3-0",
};

function makeDeps(overrides?: {
  /** null = 显式未配置生图 provider（否则默认 PROVIDER） */
  provider?: ImageGenProviderRef | null;
  /** null = 显式无 API Key（否则默认 "sk-test"） */
  apiKey?: string | null;
  fetchImpl?: FetchLike;
}) {
  const provider = overrides?.provider === null ? undefined : (overrides?.provider ?? PROVIDER);
  return {
    resolveImageGenProvider: () => provider,
    getApiKey: () => (overrides?.apiKey === null ? undefined : (overrides?.apiKey ?? "sk-test")),
    fetchImpl:
      overrides?.fetchImpl ?? (async () => jsonResp({ data: [{ b64_json: PNG_1PX_B64 }] })),
  };
}

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  details: { paths?: string[] };
};

async function runTool(
  deps: ReturnType<typeof makeDeps>,
  params: { prompt: string; size?: string; n?: number },
): Promise<ToolResult> {
  const tool = await createGenerateImageToolDefinition(cwd, deps);
  return tool.execute("tc1", params) as Promise<ToolResult>;
}

describe("createGenerateImageToolDefinition", () => {
  it("保存图片到 generated/ 并返回文本 + 图片块", async () => {
    const result = await runTool(makeDeps(), { prompt: "一只卡通猫" });
    expect(result.details.paths).toHaveLength(1);
    const rel = result.details.paths![0]!;
    expect(rel).toMatch(/^generated\//);
    const files = readdirSync(path.join(cwd, "generated"));
    expect(files).toHaveLength(1);
    expect(path.basename(files[0]!)).toBe(path.basename(rel));

    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toContain("已生成 1 张图片");
    expect(result.content[0]!.text).toContain(rel);
    const imgBlock = result.content[1]!;
    expect(imgBlock.type).toBe("image");
    expect(imgBlock.data).toBe(PNG_1PX_B64);
    expect(imgBlock.mimeType).toBe("image/png");
  });

  it("未配置生图模型 → 可读错误（不抛错）", async () => {
    const result = await runTool(makeDeps({ provider: null }), { prompt: "x" });
    expect(result.content[0]!.text).toContain("未配置生图模型");
    expect(result.details.paths).toBeUndefined();
  });

  it("缺少 API Key → 可读错误", async () => {
    const result = await runTool(makeDeps({ apiKey: null }), { prompt: "x" });
    expect(result.content[0]!.text).toContain("缺少 API Key");
  });

  it("接口失败 → 错误文本包装", async () => {
    const failFetch: FetchLike = async () => ({
      ok: false,
      status: 429,
      text: async () => "rate limited",
      json: async () => ({}),
      arrayBuffer: async () => new Uint8Array(),
    });
    const result = await runTool(makeDeps({ fetchImpl: failFetch }), { prompt: "x" });
    expect(result.content[0]!.text).toContain("图片生成失败");
    expect(result.content[0]!.text).toContain("429");
  });

  it("n=2 生成两张，路径去重", async () => {
    const fetchImpl: FetchLike = async () =>
      jsonResp({ data: [{ b64_json: PNG_1PX_B64 }, { b64_json: PNG_1PX_B64 }] });
    const result = await runTool(makeDeps({ fetchImpl }), { prompt: "风景", n: 2 });
    expect(result.details.paths).toHaveLength(2);
    expect(new Set(result.details.paths).size).toBe(2);
    expect(readdirSync(path.join(cwd, "generated"))).toHaveLength(2);
  });
});
