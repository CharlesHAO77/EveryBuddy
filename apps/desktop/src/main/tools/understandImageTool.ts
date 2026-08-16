/**
 * understandImageTool - 视觉理解自定义工具（understand_image）。
 *
 * Agent 对 uploads/ 下的图片按需进行视觉理解（描述/问答）。内部把图片交给
 * 已配置的视觉理解模型（能力标签或 agent 配置指定）做一次性调用，返回文本。
 *
 * 与 parse_attachment / grepTool 同一模式：TypeBox 参数、execute 返回
 * `{ content, details }`，错误以工具文本返回而不抛错。
 */

import path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseFileContent, resolveInUploads } from "../services/fileParser";
import type { DescribeImageModel, ImageInput } from "../services/vision";

/** understand_image 工具的运行时依赖（agentRuntime 注入，测试可 fake） */
export interface UnderstandImageToolDeps {
  /**
   * 实时解析当前模式应使用的视觉模型（配置 visionModelProviderId 或能力标签）。
   * 返回 undefined 表示未配置。每次调用都解析，新打标签的模型无需重建会话即生效。
   */
  resolveVisionModel: () => DescribeImageModel | undefined;
  /** 一次性视觉理解调用（agentRuntime 包装 vision.describeImage；signal 来自 agent.run abortController） */
  describeImage: (
    model: DescribeImageModel,
    image: ImageInput,
    question?: string,
    signal?: AbortSignal,
  ) => Promise<string>;
  /** 已配置的视觉 provider id（仅用于 details 标注） */
  visionProviderId?: () => string | undefined;
}

export async function createUnderstandImageToolDefinition(
  cwd: string,
  deps: UnderstandImageToolDeps,
): Promise<ToolDefinition> {
  const { Type } = await import("typebox");
  return {
    name: "understand_image",
    label: "视觉理解",
    description:
      "对上传的图片进行视觉理解（描述/问答）。图片文件用本工具而非 read：read 只展示图片，本工具会调用视觉模型分析内容并返回文字结果。参数 file 为 uploads/ 目录下的文件名，question 为可选的具体问题。",
    parameters: Type.Object({
      file: Type.String({ description: "uploads/ 下的图片文件名（如 photo.png）" }),
      question: Type.Optional(
        Type.String({ description: "针对图片的具体问题；缺省为描述图片内容" }),
      ),
    }),
    execute: async (
      _toolCallId: string,
      params: { file: string; question?: string },
      signal?: AbortSignal,
    ) => {
      const filePath = resolveInUploads(path.join(cwd, "uploads"), params.file);
      if (!filePath) {
        return {
          content: [{ type: "text", text: "[无效路径：文件必须位于 uploads/ 目录下]" }],
          details: {},
        };
      }
      const model = deps.resolveVisionModel();
      if (!model) {
        return {
          content: [
            {
              type: "text",
              text: "[未配置视觉理解模型：请在模型设置中勾选「视觉理解」，或在 agent 配置中指定 visionModelProviderId]",
            },
          ],
          details: {},
        };
      }
      const { content } = await parseFileContent(filePath, { resizeImages: true });
      const image = content.find(
        (c): c is { type: "image"; data: string; mimeType: string } => c.type === "image",
      );
      if (!image) {
        return {
          content: [{ type: "text", text: "[该文件不是可识别的图片格式]" }],
          details: {},
        };
      }
      try {
        const description = await deps.describeImage(model, image, params.question, signal);
        return {
          content: [{ type: "text", text: description }],
          details: { usedVisionModel: deps.visionProviderId?.() },
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `[视觉理解失败: ${err instanceof Error ? err.message : String(err)}]`,
            },
          ],
          details: {},
        };
      }
    },
  };
}
