/**
 * modelStore 单元测试——临时目录注入 paths，不触碰真实 ~/EveryBuddy。
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getApiKey,
  getDefaultProviderId,
  getImageGenModel,
  getVisionModel,
  hasApiKey,
  hasCapability,
  listProviders,
  type ModelStorePaths,
  migrateFromLegacyConfig,
  providerEntryFromSaveRequest,
  removeProvider,
  saveProvider,
  setApiKey,
} from "../src/main/modelStore";

/** 无能力标签的完整 SaveModelRequest（贴近旧测试语义） */
const PLAIN_CAP = { vision: false, imageGen: false };

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
    const entry = providerEntryFromSaveRequest({
      id: "p1",
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-flash",
      isOpenAiCompatible: true,
      capabilities: { vision: false, imageGen: false },
    });
    expect(entry).toEqual({
      name: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      api: "openai-completions",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      models: [{ id: "deepseek-v4-flash" }],
      capabilities: { vision: false, imageGen: false },
    });
    expect(entry).not.toHaveProperty("apiKey");
  });

  it("omits api for non-OpenAI-compatible", () => {
    const entry = providerEntryFromSaveRequest({
      id: "p1",
      name: "X",
      baseUrl: "https://x.example",
      model: "m",
      isOpenAiCompatible: false,
      capabilities: { vision: false, imageGen: false },
    });
    expect(entry.api).toBeUndefined();
  });
});

describe("capabilities", () => {
  const visionReq = {
    id: "v1",
    name: "Doubao Vision",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-vision",
    isOpenAiCompatible: true,
    capabilities: { vision: true, imageGen: false },
  };
  const genReq = {
    id: "g1",
    name: "Seedream",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "seedream-3-0",
    isOpenAiCompatible: true,
    capabilities: { vision: false, imageGen: true },
  };

  it("writes models[].input for vision; omits for non-vision", () => {
    const vision = providerEntryFromSaveRequest(visionReq);
    expect(vision.models).toEqual([{ id: "doubao-vision", input: ["text", "image"] }]);
    const plain = providerEntryFromSaveRequest({
      ...visionReq,
      id: "p",
      capabilities: { vision: false, imageGen: false },
    });
    expect(plain.models).toEqual([{ id: "doubao-vision" }]);
    expect(JSON.stringify(plain.models)).not.toContain("input");
  });

  it("round-trips capabilities through save/list", () => {
    saveProvider(visionReq, paths);
    saveProvider(genReq, paths);
    const list = listProviders(paths);
    expect(list.find((m) => m.id === "v1")?.capabilities).toEqual({
      vision: true,
      imageGen: false,
    });
    expect(list.find((m) => m.id === "g1")?.capabilities).toEqual({
      vision: false,
      imageGen: true,
    });
  });

  it("defaults missing capabilities to false", () => {
    // 手写旧格式 models.json（无 capabilities 字段）
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
        },
      }),
      "utf-8",
    );
    expect(listProviders(paths)[0]?.capabilities).toEqual({ vision: false, imageGen: false });
  });

  it("getVisionModel / getImageGenModel pick first tagged provider", () => {
    saveProvider({ ...visionReq, id: "a" }, paths);
    saveProvider({ ...genReq, id: "b" }, paths);
    saveProvider({ ...genReq, id: "c" }, paths);
    expect(getVisionModel(paths)).toBe("a");
    expect(getImageGenModel(paths)).toBe("b");
    expect(hasCapability("a", "vision", paths)).toBe(true);
    expect(hasCapability("a", "imageGen", paths)).toBe(false);
    expect(getVisionModel(paths)).toBe("a");
  });

  it("getApiKey reads auth.json", () => {
    saveProvider(visionReq, paths);
    setApiKey("v1", "sk-vision", paths);
    expect(getApiKey("v1", paths)).toBe("sk-vision");
    expect(getApiKey("ghost", paths)).toBeUndefined();
  });
});

describe("save / list providers", () => {
  const req = {
    id: "p1",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    isOpenAiCompatible: true,
    capabilities: { ...PLAIN_CAP },
  };

  it("round-trips saveProvider -> listProviders", () => {
    saveProvider(req, paths);
    expect(listProviders(paths)).toEqual([{ ...req, hasApiKey: false }]);
  });

  it("upserts existing provider", () => {
    saveProvider(req, paths);
    saveProvider({ ...req, name: "DeepSeek2", model: "deepseek-v4-flash2" }, paths);
    const list = listProviders(paths);
    expect(list).toHaveLength(1);
    expect(list[0]?.model).toBe("deepseek-v4-flash2");
    expect(list[0]?.name).toBe("DeepSeek2");
  });

  it("writes no apiKey field into models.json", () => {
    saveProvider(req, paths);
    const raw = JSON.parse(readFileSync(paths.modelsPath, "utf-8"));
    expect(raw.providers.p1).not.toHaveProperty("apiKey");
  });

  it("getDefaultProviderId returns first provider", () => {
    saveProvider({ ...req, id: "a" }, paths);
    saveProvider({ ...req, id: "b" }, paths);
    expect(getDefaultProviderId(paths)).toBe("a");
  });

  it("removeProvider clears both models.json and auth.json", () => {
    saveProvider(req, paths);
    setApiKey("p1", "sk-secret", paths);
    removeProvider("p1", paths);
    expect(listProviders(paths)).toEqual([]);
    expect(hasApiKey("p1", paths)).toBe(false);
    expect(getDefaultProviderId(paths)).toBeUndefined();
  });
});

describe("setApiKey / auth.json", () => {
  const req = {
    id: "p1",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    isOpenAiCompatible: true,
    capabilities: { ...PLAIN_CAP },
  };

  it("writes SDK AuthStorage format with mode 0600", () => {
    saveProvider(req, paths);
    setApiKey("p1", "sk-secret", paths);
    const raw = JSON.parse(readFileSync(paths.authPath, "utf-8"));
    expect(raw.p1).toEqual({ type: "api_key", key: "sk-secret" });
    expectAuthFileMode(paths.authPath);
    expect(hasApiKey("p1", paths)).toBe(true);
    expect(listProviders(paths)[0]?.hasApiKey).toBe(true);
  });

  it("merges without clobbering other providers", () => {
    saveProvider({ ...req, id: "a" }, paths);
    saveProvider({ ...req, id: "b" }, paths);
    setApiKey("a", "sk-a", paths);
    setApiKey("b", "sk-b", paths);
    const raw = JSON.parse(readFileSync(paths.authPath, "utf-8"));
    expect(raw.a).toEqual({ type: "api_key", key: "sk-a" });
    expect(raw.b).toEqual({ type: "api_key", key: "sk-b" });
  });

  it("throws for unknown provider", () => {
    expect(() => setApiKey("ghost", "sk-x", paths)).toThrow("模型不存在");
  });

  it("leaves no .tmp file behind after write", () => {
    saveProvider(req, paths);
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
