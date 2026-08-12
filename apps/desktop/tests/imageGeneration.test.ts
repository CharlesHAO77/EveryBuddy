/**
 * imageGeneration 原语单元测试——stub fetch，覆盖 b64_json/url 双分支与错误路径。
 */
import { describe, expect, it } from "vitest";
import { type FetchLike, httpGenerateImage } from "../src/main/imageGeneration";

const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PNG_1PX_BYTES = Buffer.from(PNG_1PX_B64, "base64");

/** 构造 fetch 响应桩 */
function resp(init: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
  bytes?: Uint8Array;
}): Awaited<ReturnType<FetchLike>> {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: async () => init.text ?? "",
    json: async () => init.json ?? {},
    arrayBuffer: async () => init.bytes ?? new Uint8Array(),
  } as Awaited<ReturnType<FetchLike>>;
}

function makeFetch(
  handler: (url: string, init?: unknown) => Awaited<ReturnType<FetchLike>>,
): FetchLike {
  return (url, init) => Promise.resolve(handler(url, init));
}

const OPTS = {
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  apiKey: "sk-test",
  model: "seedream-3-0",
};

describe("httpGenerateImage", () => {
  it("POST /images/generations，携带 Bearer 与 body", async () => {
    let capturedUrl = "";
    let capturedInit:
      | { method?: string; headers?: Record<string, string>; body?: string }
      | undefined;
    const fetchImpl = makeFetch((url, init) => {
      capturedUrl = url;
      capturedInit = init as typeof capturedInit;
      return resp({ json: { data: [{ b64_json: PNG_1PX_B64 }] } });
    });
    const result = await httpGenerateImage(
      OPTS,
      { prompt: "一只猫", size: "1024x1024", n: 2 },
      fetchImpl,
    );

    expect(capturedUrl).toBe("https://ark.cn-beijing.volces.com/api/v3/images/generations");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers?.Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(capturedInit?.body ?? "{}")).toEqual({
      model: "seedream-3-0",
      prompt: "一只猫",
      size: "1024x1024",
      n: 2,
    });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]!.data).toBe(PNG_1PX_B64);
    expect(result.images[0]!.mimeType).toBe("image/png");
  });

  it("b64_json → 魔数探测 MIME（jpeg）", async () => {
    const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString("base64");
    const fetchImpl = makeFetch(() => resp({ json: { data: [{ b64_json: jpegB64 }] } }));
    const result = await httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl);
    expect(result.images[0]!.mimeType).toBe("image/jpeg");
  });

  it("url 形态：二次 fetch 下载并转 base64", async () => {
    const calls: string[] = [];
    const fetchImpl = makeFetch((url) => {
      calls.push(url);
      if (url === "https://cdn.example/img1.png") {
        return resp({ bytes: PNG_1PX_BYTES });
      }
      return resp({ json: { data: [{ url: "https://cdn.example/img1.png" }] } });
    });
    const result = await httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl);
    expect(calls[0]).toContain("/images/generations");
    expect(calls[1]).toBe("https://cdn.example/img1.png");
    expect(result.images[0]!.mimeType).toBe("image/png");
    expect(result.images[0]!.data).toBe(PNG_1PX_B64);
  });

  it("非 2xx → 抛错含状态码", async () => {
    const fetchImpl = makeFetch(() => resp({ ok: false, status: 401, text: "unauthorized" }));
    await expect(httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl)).rejects.toThrow(/401/);
  });

  it("空 data → 抛错", async () => {
    const fetchImpl = makeFetch(() => resp({ json: { data: [] } }));
    await expect(httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl)).rejects.toThrow(/未返回图片/);
  });

  it("支持自定义 apiPath 覆盖", async () => {
    let capturedUrl = "";
    const fetchImpl = makeFetch((url) => {
      capturedUrl = url;
      return resp({ json: { data: [{ b64_json: PNG_1PX_B64 }] } });
    });
    await httpGenerateImage(
      { ...OPTS, apiPath: "/v1/images/generations" },
      { prompt: "x" },
      fetchImpl,
    );
    expect(capturedUrl).toBe("https://ark.cn-beijing.volces.com/api/v3/v1/images/generations");
  });

  it("response_id 透出", async () => {
    const fetchImpl = makeFetch(() =>
      resp({ json: { data: [{ b64_json: PNG_1PX_B64 }], response_id: "rid-1" } }),
    );
    const result = await httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl);
    expect(result.responseId).toBe("rid-1");
  });

  it("abort 信号透传给 fetch init（生图即时取消）", async () => {
    let capturedSignal: unknown;
    const fetchImpl = makeFetch((_url, init) => {
      capturedSignal = (init as { signal?: unknown } | undefined)?.signal;
      return resp({ json: { data: [{ b64_json: PNG_1PX_B64 }] } });
    });
    const ctrl = new AbortController();
    await httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl, ctrl.signal);
    expect(capturedSignal).toBe(ctrl.signal);
  });

  it("url 形态的二次下载也透传 signal", async () => {
    const calls: Array<{ url: string; signal: unknown }> = [];
    const fetchImpl = makeFetch((url, init) => {
      calls.push({ url, signal: (init as { signal?: unknown } | undefined)?.signal });
      if (url === "https://cdn.example/img1.png") {
        return resp({ bytes: PNG_1PX_BYTES });
      }
      return resp({ json: { data: [{ url: "https://cdn.example/img1.png" }] } });
    });
    const ctrl = new AbortController();
    await httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl, ctrl.signal);
    expect(calls[0]?.signal).toBe(ctrl.signal);
    expect(calls[1]?.signal).toBe(ctrl.signal);
  });

  it("已 abort 的信号 → fetch 以 AbortError 拒绝", async () => {
    const fetchImpl = makeFetch((_url, init) => {
      const signal = (init as { signal?: AbortSignal } | undefined)?.signal;
      if (signal?.aborted) {
        return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
      }
      return resp({ json: { data: [{ b64_json: PNG_1PX_B64 }] } });
    });
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(httpGenerateImage(OPTS, { prompt: "x" }, fetchImpl, ctrl.signal)).rejects.toThrow(
      /aborted/i,
    );
  });
});
