/**
 * generateImageTool - 生图自定义工具（generate_image）。
 *
 * 根据文本提示词调用已配置的生图模型（OpenAI 兼容 /images/generations），
 * 把结果保存到工作目录 generated/ 下，并返回文本 + 图片内容块（UI 直接渲染）。
 * 图片块即使当前对话模型不支持视觉也会被 SDK 安全降级为文本占位符。
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type FetchLike, httpGenerateImage } from "../services/imageGeneration";

/** 生图 provider 的运行时描述（agentRuntime 从 models.json 解析） */
export interface ImageGenProviderRef {
  providerId: string;
  baseUrl: string;
  model: string;
  /** 生图接口路径覆盖（缺省 /images/generations） */
  apiPath?: string;
}

/** generate_image 工具的运行时依赖（agentRuntime 注入，测试可 fake） */
export interface GenerateImageToolDeps {
  /** 实时解析当前模式应使用的生图 provider（配置 imageGenModelProviderId 或能力标签） */
  resolveImageGenProvider: () => ImageGenProviderRef | undefined;
  /** 读取 provider 的 API Key（auth.json） */
  getApiKey: (providerId: string) => string | undefined;
  /** fetch 注入（单测 stub） */
  fetchImpl?: FetchLike;
}

/** 由提示词生成稳定的文件名前缀（字母数字中文 → - 拼接） */
function slugifyPrompt(prompt: string): string {
  const slug = prompt
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return slug || "image";
}

/** generated/ 下冲突去重：{prefix}-{ts}-{i}.png */
function uniqueGeneratedName(dir: string, prefix: string, index: number): string {
  const ts = Date.now();
  let candidate = `${prefix}-${ts}-${index}.png`;
  let i = index;
  while (existsSync(path.join(dir, candidate))) {
    i += 1;
    candidate = `${prefix}-${ts}-${i}.png`;
  }
  return candidate;
}

export async function createGenerateImageToolDefinition(
  cwd: string,
  deps: GenerateImageToolDeps,
): Promise<ToolDefinition> {
  const { Type } = await import("typebox");
  return {
    name: "generate_image",
    label: "生图",
    description:
      "根据文本提示词生成图片并保存到工作目录 generated/ 下。用于需要配图/示意图/海报等场景。参数 prompt 为图片内容描述（越具体越好），size 可选（如 1024x1024），n 为生成张数（默认 1）。",
    parameters: Type.Object({
      prompt: Type.String({ description: "图片内容描述（中文/英文）" }),
      size: Type.Optional(Type.String({ description: "如 1024x1024，默认由服务端决定" })),
      n: Type.Optional(Type.Number({ description: "生成张数，默认 1" })),
    }),
    execute: async (
      _toolCallId: string,
      params: { prompt: string; size?: string; n?: number },
      signal?: AbortSignal,
    ) => {
      const provider = deps.resolveImageGenProvider();
      if (!provider) {
        return {
          content: [
            {
              type: "text",
              text: "[未配置生图模型：请在模型设置中勾选「生图」，或在 agent 配置中指定 imageGenModelProviderId]",
            },
          ],
          details: {},
        };
      }
      const apiKey = deps.getApiKey(provider.providerId);
      if (!apiKey) {
        return {
          content: [{ type: "text", text: `[生图模型 ${provider.providerId} 缺少 API Key]` }],
          details: {},
        };
      }
      let images: Array<{ data: string; mimeType: string }>;
      try {
        const result = await httpGenerateImage(
          { baseUrl: provider.baseUrl, apiKey, model: provider.model, apiPath: provider.apiPath },
          { prompt: params.prompt, size: params.size, n: params.n },
          deps.fetchImpl,
          signal,
        );
        images = result.images;
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `[图片生成失败: ${err instanceof Error ? err.message : String(err)}]`,
            },
          ],
          details: {},
        };
      }

      // 保存到 <cwd>/generated/
      const genDir = path.join(cwd, "generated");
      await mkdir(genDir, { recursive: true });
      const prefix = slugifyPrompt(params.prompt);
      const saved: string[] = [];
      const blocks: Array<
        { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
      > = [];
      for (const [i, img] of images.entries()) {
        const name = uniqueGeneratedName(genDir, prefix, i);
        await writeFile(path.join(genDir, name), Buffer.from(img.data, "base64"));
        saved.push(`generated/${name}`);
        blocks.push({ type: "image", data: img.data, mimeType: img.mimeType });
      }
      blocks.unshift({
        type: "text",
        text: `已生成 ${images.length} 张图片，保存于工作目录：\n${saved.map((p) => `- ${p}`).join("\n")}`,
      });
      return {
        content: blocks,
        details: { paths: saved },
      };
    },
  };
}
