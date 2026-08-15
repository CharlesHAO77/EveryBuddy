/**
 * modelStore 单元测试——临时目录注入 paths，不触碰真实 ~/EveryBuddy。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getActiveModelOfType,
  getApiKey,
  getDefaultProviderId,
  getImageGenModel,
  getVisionModel,
  hasApiKey,
  hasCapability,
  isChatModelProviderId,
  listProviders,
  type ModelStorePaths,
  migrateFromLegacyConfig,
  providerEntryFromSaveRequest,
  removeProvider,
  saveProvider,
  setActiveModel,
  setApiKey,
  typeFromCapabilities,
} from "../src/main/modelStore";

/** 无能力标签的完整 SaveModelRequest（贴近旧测试语义） */
const LLM_REQ = {
  id: "p1",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-v4-flash",
  isOpenAiCompatible: true,
  type: "llm" as const,
};

const VISION_REQ = {
  id: "v1",
  name: "Doubao Vision",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-vision",
  isOpenAiCompatible: true,
  type: "vlm" as const,
};

const GEN_REQ = {
  id: "g1",
  name: "Seedream",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  model: "seedream-3-0",
  isOpenAiCompatible: true,
  type: "image" as const,
};

/**
 * 校验 auth.json 权限为 0600（仅 POSIX 生效；Windows 使用 ACL，unix 权限位无意义，
 * stat().mode 恒为 0o666，故跳过）。
 */
function expectAuthFileMode(p: string): void {
  if (process.platform !== "win32") {
    expect(statSync(p).mode & 0o777).toBe(0o600);
  }
}

let tmpDir: string;
let paths: ModelStorePaths;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "everybuddy-modelstore-"));
  paths = {
    modelsPath: path.join(tmpDir, "models.json"),
    authPath: path.join(tmpDir, "auth.json"),
    configPath: path.join(tmpDir, "config.json"),
  };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("providerEntryFromSaveRequest", () => {
  it("maps SaveModelRequest to SDK provider entry without apiKey", () => {
    const entry = providerEntryFromSaveRequest(LLM_REQ);
    expect(entry).toEqual({
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      api: "openai-completions",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      models: [{ id: "deepseek-v4-flash" }],
      capabilities: { vision: false, imageGen: false },
      type: "llm",
    });
    expect(entry).not.toHaveProperty("apiKey");
  });

  it("omits api for non-OpenAI-compatible", () => {
    const entry = providerEntryFromSaveRequest({ ...LLM_REQ, isOpenAiCompatible: false });
    expect(entry.api).toBeUndefined();
  });
});

describe("type → capabilities", () => {
  it("writes models[].input for vlm; omits for llm/image", () => {
    expect(providerEntryFromSaveRequest(VISION_REQ).models).toEqual([
      { id: "doubao-vision", input: ["text", "image"] },
    ]);
    const plain = providerEntryFromSaveRequest(LLM_REQ);
    expect(plain.models).toEqual([{ id: "deepseek-v4-flash" }]);
    expect(JSON.stringify(plain.models)).not.toContain("input");
    expect(providerEntryFromSaveRequest(GEN_REQ).models).toEqual([{ id: "seedream-3-0" }]);
  });

  it("derives capabilities from type through save/list", () => {
    saveProvider(VISION_REQ, paths);
    saveProvider(GEN_REQ, paths);
    saveProvider(LLM_REQ, paths);
    const list = listProviders(paths);
    expect(list.find((m) => m.id === "v1")?.capabilities).toEqual({
      vision: true,
      imageGen: false,
    });
    expect(list.find((m) => m.id === "g1")?.capabilities).toEqual({
      vision: false,
      imageGen: true,
    });
    expect(list.find((m) => m.id === "p1")?.capabilities).toEqual({
      vision: false,
      imageGen: false,
    });
    expect(list.find((m) => m.id === "v1")?.type).toBe("vlm");
    expect(list.find((m) => m.id === "g1")?.type).toBe("image");
  });

  it("typeFromCapabilities: vision 优先于 imageGen", () => {
    expect(typeFromCapabilities({ vision: false, imageGen: false })).toBe("llm");
    expect(typeFromCapabilities({ vision: true, imageGen: false })).toBe("vlm");
    expect(typeFromCapabilities({ vision: false, imageGen: true })).toBe("image");
    expect(typeFromCapabilities({ vision: true, imageGen: true })).toBe("vlm");
  });

  it("infers type for legacy models.json without type field", () => {
    // 手写旧格式 models.json（无 type，部分带 capabilities）
    writeFileSync(
      paths.modelsPath,
      JSON.stringify({
        providers: {
          old: {
            name: "Old",
            baseUrl: "https://x.example",
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
            models: [{ id: "m" }],
          },
          vision: {
            name: "Vision",
            baseUrl: "https://x.example",
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
            models: [{ id: "m" }],
            capabilities: { vision: true, imageGen: false },
          },
        },
      }),
      "utf-8",
    );
    const list = listProviders(paths);
    expect(list.find((m) => m.id === "old")?.type).toBe("llm");
    expect(list.find((m) => m.id === "old")?.capabilities).toEqual({
      vision: false,
      imageGen: false,
    });
    expect(list.find((m) => m.id === "vision")?.type).toBe("vlm");
  });

  it("getVisionModel / getImageGenModel pick first tagged provider", () => {
    saveProvider({ ...VISION_REQ, id: "a" }, paths);
    saveProvider({ ...GEN_REQ, id: "b" }, paths);
    saveProvider({ ...GEN_REQ, id: "c" }, paths);
    expect(getVisionModel(paths)).toBe("a");
    expect(getImageGenModel(paths)).toBe("b");
    expect(hasCapability("a", "vision", paths)).toBe(true);
    expect(hasCapability("a", "imageGen", paths)).toBe(false);
  });

  it("getApiKey reads auth.json", () => {
    saveProvider(VISION_REQ, paths);
    setApiKey("v1", "sk-vision", paths);
    expect(getApiKey("v1", paths)).toBe("sk-vision");
    expect(getApiKey("ghost", paths)).toBeUndefined();
  });
});

describe("save / list providers", () => {
  it("round-trips saveProvider -> listProviders", () => {
    saveProvider(LLM_REQ, paths);
    expect(listProviders(paths)).toEqual([
      {
        ...LLM_REQ,
        hasApiKey: false,
        capabilities: { vision: false, imageGen: false },
        active: false,
      },
    ]);
  });

  it("upserts existing provider", () => {
    saveProvider(LLM_REQ, paths);
    saveProvider({ ...LLM_REQ, name: "DeepSeek2", model: "deepseek-v4-flash2" }, paths);
    const list = listProviders(paths);
    expect(list).toHaveLength(1);
    expect(list[0]?.model).toBe("deepseek-v4-flash2");
    expect(list[0]?.name).toBe("DeepSeek2");
  });

  it("writes no apiKey field into models.json", () => {
    saveProvider(LLM_REQ, paths);
    const raw = JSON.parse(readFileSync(paths.modelsPath, "utf-8"));
    expect(raw.providers.p1).not.toHaveProperty("apiKey");
  });

  it("getDefaultProviderId returns first non-image provider", () => {
    saveProvider({ ...GEN_REQ, id: "img" }, paths);
    saveProvider({ ...LLM_REQ, id: "chat" }, paths);
    saveProvider({ ...VISION_REQ, id: "vis" }, paths);
    // image 在前，应跳过取第一个可对话模型
    expect(getDefaultProviderId(paths)).toBe("chat");
  });

  it("getDefaultProviderId returns undefined when only image providers exist", () => {
    saveProvider({ ...GEN_REQ, id: "img" }, paths);
    expect(getDefaultProviderId(paths)).toBeUndefined();
  });

  it("isChatModelProviderId: image 专用不可对话", () => {
    saveProvider(GEN_REQ, paths);
    saveProvider(LLM_REQ, paths);
    expect(isChatModelProviderId("g1", paths)).toBe(false);
    expect(isChatModelProviderId("p1", paths)).toBe(true);
    expect(isChatModelProviderId("ghost", paths)).toBe(false);
  });

  it("removeProvider clears both models.json and auth.json", () => {
    saveProvider(LLM_REQ, paths);
    setApiKey("p1", "sk-secret", paths);
    removeProvider("p1", paths);
    expect(listProviders(paths)).toEqual([]);
    expect(hasApiKey("p1", paths)).toBe(false);
    expect(getDefaultProviderId(paths)).toBeUndefined();
  });
});

describe("setActiveModel / 每类型激活模型", () => {
  it("激活一个模型并清空同类型其余 active，不同类型互不影响", () => {
    saveProvider({ ...LLM_REQ, id: "a" }, paths);
    saveProvider({ ...LLM_REQ, id: "b" }, paths);
    saveProvider({ ...VISION_REQ, id: "v1" }, paths);
    saveProvider({ ...GEN_REQ, id: "g1" }, paths);

    setActiveModel("b", paths);
    const list = listProviders(paths);
    expect(list.find((m) => m.id === "a")?.active).toBe(false);
    expect(list.find((m) => m.id === "b")?.active).toBe(true);
    // 不同类型不受影响
    expect(list.find((m) => m.id === "v1")?.active).toBe(false);
    expect(list.find((m) => m.id === "g1")?.active).toBe(false);

    // 再激活 vlm：llm 的 active 保留
    setActiveModel("v1", paths);
    const list2 = listProviders(paths);
    expect(list2.find((m) => m.id === "b")?.active).toBe(true);
    expect(list2.find((m) => m.id === "v1")?.active).toBe(true);
    expect(getActiveModelOfType("llm", paths)).toBe("b");
    expect(getActiveModelOfType("vlm", paths)).toBe("v1");
  });

  it("throws for unknown provider", () => {
    expect(() => setActiveModel("ghost", paths)).toThrow("errors.modelNotFound");
  });

  it("saveProvider preserves active on upsert", () => {
    saveProvider({ ...LLM_REQ, id: "a" }, paths);
    setActiveModel("a", paths);
    saveProvider({ ...LLM_REQ, id: "a", name: "Renamed" }, paths);
    expect(listProviders(paths).find((m) => m.id === "a")?.active).toBe(true);
  });
});

describe("激活模型优先作为默认", () => {
  it("getDefaultProviderId：无 active 回退第一个非 image", () => {
    saveProvider({ ...LLM_REQ, id: "llmA" }, paths);
    saveProvider({ ...LLM_REQ, id: "llmB" }, paths);
    expect(getDefaultProviderId(paths)).toBe("llmA");
    setActiveModel("llmB", paths);
    expect(getDefaultProviderId(paths)).toBe("llmB");
  });

  it("getDefaultProviderId：无 active LLM 时回退 active VLM", () => {
    saveProvider({ ...VISION_REQ, id: "vis" }, paths);
    saveProvider({ ...LLM_REQ, id: "llm" }, paths);
    setActiveModel("vis", paths);
    expect(getDefaultProviderId(paths)).toBe("vis");
  });

  it("getVisionModel prefers active VLM", () => {
    saveProvider({ ...VISION_REQ, id: "visA" }, paths);
    saveProvider({ ...VISION_REQ, id: "visB" }, paths);
    expect(getVisionModel(paths)).toBe("visA");
    setActiveModel("visB", paths);
    expect(getVisionModel(paths)).toBe("visB");
  });

  it("getImageGenModel prefers active Image", () => {
    saveProvider({ ...GEN_REQ, id: "genA" }, paths);
    saveProvider({ ...GEN_REQ, id: "genB" }, paths);
    expect(getImageGenModel(paths)).toBe("genA");
    setActiveModel("genB", paths);
    expect(getImageGenModel(paths)).toBe("genB");
  });
});

describe("setApiKey / auth.json", () => {
  it("writes SDK AuthStorage format with mode 0600", () => {
    saveProvider(LLM_REQ, paths);
    setApiKey("p1", "sk-secret", paths);
    const raw = JSON.parse(readFileSync(paths.authPath, "utf-8"));
    expect(raw.p1).toEqual({ type: "api_key", key: "sk-secret" });
    expectAuthFileMode(paths.authPath);
    expect(hasApiKey("p1", paths)).toBe(true);
    expect(listProviders(paths)[0]?.hasApiKey).toBe(true);
  });

  it("merges without clobbering other providers", () => {
    saveProvider({ ...LLM_REQ, id: "a" }, paths);
    saveProvider({ ...LLM_REQ, id: "b" }, paths);
    setApiKey("a", "sk-a", paths);
    setApiKey("b", "sk-b", paths);
    const raw = JSON.parse(readFileSync(paths.authPath, "utf-8"));
    expect(raw.a).toEqual({ type: "api_key", key: "sk-a" });
    expect(raw.b).toEqual({ type: "api_key", key: "sk-b" });
  });

  it("throws for unknown provider", () => {
    expect(() => setApiKey("ghost", "sk-x", paths)).toThrow("errors.modelNotFound");
  });

  it("leaves no .tmp file behind after write", () => {
    saveProvider(LLM_REQ, paths);
    setApiKey("p1", "sk-secret", paths);
    const leftovers = readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
  });
});

describe("migrateFromLegacyConfig", () => {
  it("no-ops when config.json has no models", () => {
    writeFileSync(paths.configPath, JSON.stringify({ workspaces: [], tasks: [] }), "utf-8");
    migrateFromLegacyConfig(paths);
    expect(listProviders(paths)).toEqual([]);
    expect(hasApiKey("p1", paths)).toBe(false);
  });

  it("moves legacy models + apiKey into models.json / auth.json and strips config.json", () => {
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        models: [
          {
            id: "p1",
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com/v1",
            model: "deepseek-v4-flash",
            isOpenAiCompatible: true,
            apiKey: "sk-legacy",
          },
        ],
        workspaces: [],
        tasks: [{ id: "t1" }],
      }),
      "utf-8",
    );

    migrateFromLegacyConfig(paths);

    // 模型进入 models.json，无 apiKey 字段
    const modelsRaw = JSON.parse(readFileSync(paths.modelsPath, "utf-8"));
    expect(modelsRaw.providers.p1.name).toBe("DeepSeek");
    expect(modelsRaw.providers.p1.models).toEqual([{ id: "deepseek-v4-flash" }]);
    expect(modelsRaw.providers.p1).not.toHaveProperty("apiKey");

    // 密钥进入 auth.json（0600）
    const authRaw = JSON.parse(readFileSync(paths.authPath, "utf-8"));
    expect(authRaw.p1).toEqual({ type: "api_key", key: "sk-legacy" });
    expectAuthFileMode(paths.authPath);

    // config.json 剥离 models，保留 workspaces/tasks
    const configRaw = JSON.parse(readFileSync(paths.configPath, "utf-8"));
    expect(configRaw).not.toHaveProperty("models");
    expect(configRaw.tasks).toEqual([{ id: "t1" }]);
  });

  it("is idempotent when run twice", () => {
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        models: [
          {
            id: "p1",
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com/v1",
            model: "deepseek-v4-flash",
            isOpenAiCompatible: true,
            apiKey: "sk-legacy",
          },
        ],
        workspaces: [],
        tasks: [],
      }),
      "utf-8",
    );

    migrateFromLegacyConfig(paths);
    const authAfterFirst = readFileSync(paths.authPath, "utf-8");
    const configAfterFirst = readFileSync(paths.configPath, "utf-8");

    migrateFromLegacyConfig(paths);

    // 第二次运行：config.json 已无 models → no-op，文件不变
    expect(readFileSync(paths.authPath, "utf-8")).toBe(authAfterFirst);
    expect(readFileSync(paths.configPath, "utf-8")).toBe(configAfterFirst);
  });

  it("keeps existing models.json provider but strips its fake apiKey", () => {
    // models.json 已有派生 provider（旧版产物，带假的 apiKey:"placeholder"）
    writeFileSync(
      paths.modelsPath,
      JSON.stringify({
        providers: {
          p1: {
            name: "DeepSeek",
            baseUrl: "https://api.deepseek.com/v1",
            api: "openai-completions",
            apiKey: "placeholder",
            compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
            models: [{ id: "deepseek-v4-flash" }],
          },
        },
      }),
      "utf-8",
    );
    writeFileSync(
      paths.configPath,
      JSON.stringify({
        models: [
          {
            id: "p1",
            name: "legacy-stale-name",
            baseUrl: "https://stale.example",
            model: "stale-model",
            isOpenAiCompatible: true,
            apiKey: "sk-legacy",
          },
        ],
        workspaces: [],
        tasks: [],
      }),
      "utf-8",
    );

    migrateFromLegacyConfig(paths);

    const modelsRaw = JSON.parse(readFileSync(paths.modelsPath, "utf-8"));
    // 保留 models.json 已有条目，不被残缺 legacy 字段覆盖
    expect(modelsRaw.providers.p1.name).toBe("DeepSeek");
    expect(modelsRaw.providers.p1.models).toEqual([{ id: "deepseek-v4-flash" }]);
    // 剥离旧的假 apiKey，密钥唯一真源是 auth.json
    expect(modelsRaw.providers.p1).not.toHaveProperty("apiKey");
    // 真实密钥迁入 auth.json
    expect(hasApiKey("p1", paths)).toBe(true);
  });
});
