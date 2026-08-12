/**
 * imageGeneration - 生图原语（OpenAI 兼容 /images/generations 直连）。
 *
 * 复用模型页的「OpenAI 兼容模型」配置（baseUrl + model + auth.json 密钥），
 * 兼容豆包 ARK / SiliconFlow / OpenAI 等生图模型。响应兼容 b64_json 与 url 两种
 * 形态（url 先 fetch 转 base64，保证落盘可控）。fetch 可注入便于单测。
 */

import { detectImageMimeType } from "./fileParser";

export interface GenerateImageParams {
  prompt: string;
  size?: string;
  n?: number;
}

export interface GenerateImageResult {
  images: Array<{ data: string; mimeType: string }>;
  responseId?: string;
}

export interface HttpGenerateImageOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** 生图接口路径覆盖（默认 /images/generations；个别 provider 用自定义路径） */
  apiPath?: string;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    /** abort 信号（生图即时取消）：abort 时 fetch 以 AbortError 拒绝 */
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/** 从字节探测图片 MIME（魔数；失败默认 image/png） */
function detectMimeFromBytes(buf: Uint8Array): string {
  return detectImageMimeType(buf) ?? "image/png";
}

/** 下载 URL 图片为 Buffer（生图响应为 url 形态时用） */
async function fetchUrlBytes(url: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetchImpl(url, { signal });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`下载生图结果失败 ${res.status}: ${body.slice(0, 200)}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * 调用 OpenAI 兼容生图接口。失败抛错（由工具层包装为可读文本）。
 * @param opts.baseUrl 含协议与路径前缀（如 https://ark.cn-beijing.volces.com/api/v3）
 */
export async function httpGenerateImage(
  opts: HttpGenerateImageOptions,
  params: GenerateImageParams,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  signal?: AbortSignal,
): Promise<GenerateImageResult> {
  const url = `${opts.baseUrl.replace(/\/+$/, "")}${opts.apiPath ?? "/images/generations"}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      prompt: params.prompt,
      size: params.size,
      n: params.n ?? 1,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`图片生成接口返回 ${res.status}: ${body.slice(0, 500) || "未知错误"}`);
  }

  const json = (await res.json()) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    response_id?: string;
  };
  const items = json.data ?? [];
  if (items.length === 0) {
    throw new Error("图片生成接口未返回图片数据");
  }

  const images: Array<{ data: string; mimeType: string }> = [];
  for (const item of items) {
    if (item.b64_json) {
      const bytes = Uint8Array.from(Buffer.from(item.b64_json, "base64"));
      images.push({ data: item.b64_json, mimeType: detectMimeFromBytes(bytes) });
    } else if (item.url) {
      const bytes = await fetchUrlBytes(item.url, fetchImpl, signal);
      images.push({
        data: Buffer.from(bytes).toString("base64"),
        mimeType: detectMimeFromBytes(bytes),
      });
    }
  }
  if (images.length === 0) {
    throw new Error("图片生成接口返回了空内容");
  }

  return {
    images,
    responseId: typeof json.response_id === "string" ? json.response_id : undefined,
  };
}
