/**
 * vision - 视觉理解一次性调用原语。
 *
 * 用配置的视觉理解模型（OpenAI 兼容，SDK ModelRuntime.complete）对单张图片做
 * 描述/问答，返回文本。供两类场景使用：
 *  1. understand_image 工具（Agent 按需追问图片细节）
 *  2. prompt() 自动调度（当前对话模型无视觉时，先让视觉模型描述图片并注入文本）
 *
 * 结构类型注入 modelRuntime / model，便于单测（不依赖 SDK 具体类型）。
 */

/** 与 pi-ai ImageContent 一致的图片块 */
export interface ImageInput {
  data: string;
  mimeType: string;
}

/** 视觉模型的最小面（与 pi-ai Model.input 对齐） */
export interface DescribeImageModel {
  input?: Array<"text" | "image">;
}

/** describeImage 所需的最小 modelRuntime 面（ModelRuntime.complete 的超集） */
export interface DescribeImageRuntime {
  complete(
    model: DescribeImageModel,
    context: {
      systemPrompt?: string;
      messages: Array<{
        role: string;
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      }>;
    },
    options?: { signal?: AbortSignal },
  ): Promise<{ content: unknown }>;
}

/** 从 complete 结果中提取文本内容（content 可能是 string 或内容块数组） */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "type" in c && c.type === "text" && "text" in c
          ? String((c as { text: unknown }).text ?? "")
          : "",
      )
      .join("");
  }
  return "";
}

/**
 * 单次视觉理解调用：向视觉模型发送一张图片（+ 可选问题），返回文本结果。
 * 失败时向上抛错，由调用方包装为工具/提示文本。
 */
export async function describeImage(
  modelRuntime: DescribeImageRuntime,
  model: DescribeImageModel,
  image: ImageInput,
  question?: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = await modelRuntime.complete(
    model,
    {
      systemPrompt:
        "你是一名视觉理解助手。请根据用户问题准确、简洁地描述图片内容；若无问题则概括图片要点。",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question?.trim() || "请描述这张图片的内容。" },
            { type: "image", data: image.data, mimeType: image.mimeType },
          ],
        },
      ],
    },
    signal ? { signal } : undefined,
  );
  const text = extractTextContent(result.content).trim();
  return text || "[视觉模型未返回文本]";
}
