/**
 * modelStore - 模型维护唯一模块（pi-ai 原生两件套，见 docs/architecture.md §7.3）。
 *
 * 模型配置统一交给 pi-ai 原生文件，App 不再维护平行注册表：
 *  - models.json：provider 配置（SDK ProviderConfigSchema 格式），本模块直写，ModelRuntime 直接消费
 *  - auth.json：凭证（SDK AuthStorage 格式 `{ providerId: { type:"api_key", key } }`，mode 0600）
 *
 * 本模块是这两份文件唯一的读写入口；config.json 不再持有模型/密钥（仅 workspaces + tasks）。
 * 主进程为 CJS 且 @earendil-works/* 被 Vite externalize → 只用 node:fs 按 SDK 格式读写，
 * 不静态 import SDK（运行时由 agentRuntime 动态加载）。
 *
 * 所有 I/O 可注入 paths，便于单测使用临时目录，不触碰真实 ~/EveryBuddy。
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ModelProviderConfig, SaveModelRequest } from "@everybuddy/ipc-contract";
import { APP_ROOT, CONFIG_PATH } from "./configStore";

export const MODELS_JSON_PATH = path.join(APP_ROOT, "models.json");
export const AUTH_PATH = path.join(APP_ROOT, "auth.json");

/** SDK ProviderConfigSchema 的应用子集（见 model-config.js ProviderConfigSchema） */
export interface ProviderEntry {
  name: string;
  baseUrl: string;
  api?: string;
  compat: { supportsDeveloperRole: boolean; supportsReasoningEffort: boolean };
  models: Array<{ id: string }>;
}

type ProvidersRecord = Record<string, ProviderEntry>;
/** SDK AuthStorage 条目格式（pi-ai AuthStorage.read 解析） */
type AuthEntry = { type: "api_key"; key: string };
type AuthRecord = Record<string, AuthEntry>;

/** 可注入路径（单测用临时目录） */
export interface ModelStorePaths {
  modelsPath: string;
  authPath: string;
  configPath: string;
}

const DEFAULT_PATHS: ModelStorePaths = {
  modelsPath: MODELS_JSON_PATH,
  authPath: AUTH_PATH,
  configPath: CONFIG_PATH,
};

// ── 纯函数 ─────────────────────────────────

/** SaveModelRequest → SDK provider 条目；不含 apiKey（密钥只进 auth.json） */
export function providerEntryFromSaveRequest(req: SaveModelRequest): ProviderEntry {
  return {
    name: req.name,
    baseUrl: req.baseUrl,
    api: req.isOpenAiCompatible ? "openai-completions" : undefined,
    compat: {
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
    },
    models: [{ id: req.model }],
  };
}

// ── models.json 读写 ────────────────────────

function readProviders(paths = DEFAULT_PATHS): ProvidersRecord {
  try {
    const parsed = JSON.parse(readFileSync(paths.modelsPath, "utf-8")) as {
      providers?: ProvidersRecord;
    };
    return parsed.providers ?? {};
  } catch {
    return {};
  }
}

function writeProviders(providers: ProvidersRecord, paths = DEFAULT_PATHS): void {
  mkdirSync(path.dirname(paths.modelsPath), { recursive: true });
  writeFileSync(paths.modelsPath, JSON.stringify({ providers }, null, 2), "utf-8");
}

// ── auth.json 读写（SDK AuthStorage 格式，0600，原子写） ──

function readAuth(paths = DEFAULT_PATHS): AuthRecord {
  try {
    return JSON.parse(readFileSync(paths.authPath, "utf-8")) as AuthRecord;
  } catch {
    return {};
  }
}

function writeAuth(entries: AuthRecord, paths = DEFAULT_PATHS): void {
  mkdirSync(path.dirname(paths.authPath), { recursive: true });
  // 原子写：先写 .tmp（0600）再 rename，SDK 读取（proper-lockfile + readFile）永不见撕裂文件
  const tmp = `${paths.authPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries, null, 2), { encoding: "utf-8", mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, paths.authPath);
}

// ── 公开 API ────────────────────────────────

/** 模型列表（UI 契约：密钥只以 hasApiKey 布尔透出） */
export function listProviders(paths = DEFAULT_PATHS): ModelProviderConfig[] {
  const providers = readProviders(paths);
  return Object.entries(providers).map(([id, entry]) => ({
    id,
    name: entry.name ?? "",
    baseUrl: entry.baseUrl ?? "",
    model: entry.models?.[0]?.id ?? "",
    isOpenAiCompatible: entry.api === "openai-completions",
    hasApiKey: hasApiKey(id, paths),
  }));
}

/** 新增/更新 provider（upsert 到 models.json） */
export function saveProvider(req: SaveModelRequest, paths = DEFAULT_PATHS): ModelProviderConfig {
  const providers = readProviders(paths);
  providers[req.id] = providerEntryFromSaveRequest(req);
  writeProviders(providers, paths);
  return {
    id: req.id,
    name: req.name,
    baseUrl: req.baseUrl,
    model: req.model,
    isOpenAiCompatible: req.isOpenAiCompatible,
    hasApiKey: hasApiKey(req.id, paths),
  };
}

/** 删除 provider：models.json 删条目 + auth.json 删密钥 */
export function removeProvider(id: string, paths = DEFAULT_PATHS): void {
  const providers = readProviders(paths);
  if (id in providers) {
    delete providers[id];
    writeProviders(providers, paths);
  }
  removeApiKey(id, paths);
}

export function hasApiKey(providerId: string, paths = DEFAULT_PATHS): boolean {
  return Boolean(readAuth(paths)[providerId]?.key);
}

/** 写入密钥（未知 provider 抛错，与旧 configStore.setApiKey 语义一致） */
export function setApiKey(providerId: string, apiKey: string, paths = DEFAULT_PATHS): void {
  if (!(providerId in readProviders(paths))) {
    throw new Error(`模型不存在: ${providerId}`);
  }
  const entries = readAuth(paths);
  if (entries[providerId]?.key === apiKey) return; // 幂等
  entries[providerId] = { type: "api_key", key: apiKey };
  writeAuth(entries, paths);
}

export function removeApiKey(providerId: string, paths = DEFAULT_PATHS): void {
  const entries = readAuth(paths);
  if (providerId in entries) {
    delete entries[providerId];
    writeAuth(entries, paths);
  }
}

/** 单 provider 详情（供 agentRuntime 取模型 id） */
export function getProvider(id: string, paths = DEFAULT_PATHS): ProviderEntry | undefined {
  return readProviders(paths)[id];
}

/** 默认模型 provider id = 第一个已配置的 provider */
export function getDefaultProviderId(paths = DEFAULT_PATHS): string | undefined {
  return Object.keys(readProviders(paths))[0];
}

// ── 迁移（一次性、幂等） ─────────────────────

/**
 * 旧版 config.json 持有 `models[]`（含明文 apiKey）。
 * 迁移：models 合并进 models.json、apiKey 转入 auth.json，然后从 config.json 剥离 models。
 * 幂等：config.json 无 models 即 no-op；任一步失败下次启动重跑（重写同值无害）。
 */
export function migrateFromLegacyConfig(paths = DEFAULT_PATHS): void {
  let parsed: {
    models?: Array<{
      id?: string;
      name?: string;
      baseUrl?: string;
      model?: string;
      isOpenAiCompatible?: boolean;
      apiKey?: string;
    }>;
  };
  try {
    parsed = JSON.parse(readFileSync(paths.configPath, "utf-8"));
  } catch {
    return; // config.json 缺失/不可解析 → 无迁移
  }
  const legacy = parsed.models;
  if (!Array.isArray(legacy) || legacy.length === 0) return;

  const providers = readProviders(paths);
  const auth = readAuth(paths);
  for (const m of legacy) {
    if (!m.id) continue;
    // models.json 已有该 provider（旧派生产物）则保留，避免用残缺 legacy 字段覆盖；
    // 但剥离旧派生产物留下的假 apiKey（密钥唯一真源是 auth.json）
    const existing = providers[m.id] as (ProviderEntry & { apiKey?: string }) | undefined;
    providers[m.id] = existing ?? {
      name: m.name ?? m.id,
      baseUrl: m.baseUrl ?? "",
      api: m.isOpenAiCompatible === false ? undefined : "openai-completions",
      compat: { supportsDeveloperRole: false, supportsReasoningEffort: false },
      models: [{ id: m.model ?? m.id }],
    };
    delete (providers[m.id] as { apiKey?: string }).apiKey;
    if (m.apiKey) auth[m.id] = { type: "api_key", key: m.apiKey };
  }
  writeProviders(providers, paths);
  writeAuth(auth, paths);

  // 剥离 config.json 的 models（保留 workspaces/tasks），并收紧权限
  const { models: _dropped, ...rest } = parsed;
  if (existsSync(paths.configPath)) chmodSync(paths.configPath, 0o600);
  writeFileSync(paths.configPath, JSON.stringify(rest, null, 2), "utf-8");
}
