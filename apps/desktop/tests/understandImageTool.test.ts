/**
 * understandImageTool 单元测试——临时 cwd + fake deps。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUnderstandImageToolDefinition } from "../src/main/tools/understandImageTool";
import type { DescribeImageModel } from "../src/main/services/vision";

const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "eb-understand-"));
  const uploads = path.join(cwd, "uploads");
  mkdirSync(uploads, { recursive: true });
  writeFileSync(path.join(uploads, "pic.png"), Buffer.from(PNG_1PX_B64, "base64"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const VISION_MODEL: DescribeImageModel = { input: ["text", "image"] };

function makeDeps(overrides?: {
  /** null = 显式未配置视觉模型（否则默认 VISION_MODEL） */
  model?: DescribeImageModel | null;
  describeText?: string;
  visionProviderId?: string;
}) {
  const model = overrides?.model === null ? undefined : (overrides?.model ?? VISION_MODEL);
  return {
    resolveVisionModel: () => model,
    describeImage: async () => overrides?.describeText ?? "这是一张柱状图，展示 Q2 营收。",
    visionProviderId: () => overrides?.visionProviderId ?? "v1",
  };
}

describe("createUnderstandImageToolDefinition", () => {
  it("对 uploads/ 内图片返回视觉模型描述文本", async () => {
    const tool = await createUnderstandImageToolDefinition(cwd, makeDeps());
    const result = await (
      tool.execute as (
        id: string,
        p: { file: string },
      ) => Promise<{
        content: Array<{ type: string; text?: string }>;
        details: Record<string, unknown>;
      }>
    )("tc1", { file: "pic.png" });
    expect(result.content[0]?.type).toBe("text");
    expect(result.content[0]?.text).toContain("柱状图");
    expect(result.details.usedVisionModel).toBe("v1");
  });

  it("未配置视觉模型 → 可读错误文本（不抛错）", async () => {
    const tool = await createUnderstandImageToolDefinition(cwd, makeDeps({ model: null }));
    const result = await (
      tool.execute as (
        id: string,
        p: { file: string },
      ) => Promise<{
        content: Array<{ type: string; text?: string }>;
      }>
    )("tc2", { file: "pic.png" });
    expect(result.content[0]?.text).toContain("未配置视觉理解模型");
  });

  it("路径逃逸 → 无效路径提示", async () => {
    const tool = await createUnderstandImageToolDefinition(cwd, makeDeps());
    const result = await (
      tool.execute as (
        id: string,
        p: { file: string },
      ) => Promise<{
        content: Array<{ type: string; text?: string }>;
      }>
    )("tc3", { file: "../secret.png" });
    expect(result.content[0]?.text).toContain("无效路径");
  });

  it("非图片文件 → 无法识别提示", async () => {
    writeFileSync(path.join(cwd, "uploads", "a.txt"), "hello", "utf-8");
    const tool = await createUnderstandImageToolDefinition(cwd, makeDeps());
    const result = await (
      tool.execute as (
        id: string,
        p: { file: string },
      ) => Promise<{
        content: Array<{ type: string; text?: string }>;
      }>
    )("tc4", { file: "a.txt" });
    expect(result.content[0]?.text).toContain("不是可识别的图片格式");
  });
});
