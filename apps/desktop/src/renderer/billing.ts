/**
 * billing - 会话级计费聚合纯函数（无 React 依赖，可单测）。
 *
 * 数据源为 JSONL 中 assistant 消息的 usage/cost（真实计费，非预留）；按模型类型
 * （llm 对话 / vlm 视觉 / image 生图）分组聚合，供 footer 计费触发与右侧面板汇总。
 */

import type { MessageUsage, ModelProviderConfig, ModelType } from "@everybuddy/ipc-contract";
import type { ChatMessage } from "./stores/sessionStore";

/** 单条消息解析出的模型信息 */
export interface ResolvedModel {
  /** 模型类型（决定分组）；解析不出为 undefined */
  type?: ModelType;
  /** 模型展示名（消息级 model 优先，回退 provider 配置的 model 字段） */
  model?: string;
}

/** 按模型类型解析消息所属模型（providerId → uiStore.models 的 type/model） */
export function resolveMessageModel(
  provider: string | undefined,
  model: string | undefined,
  models: ModelProviderConfig[],
): ResolvedModel {
  const conf = provider ? models.find((m) => m.id === provider) : undefined;
  // 消息级 model 优先；无则用 provider 配置的模型 id
  const effectiveModel = model ?? conf?.model;
  const type = conf?.type ?? (model ? inferTypeFromModels(model, models) : undefined);
  return { type, model: effectiveModel };
}

/** 通过模型 id 在配置中反查类型（provider 缺失时兜底） */
function inferTypeFromModels(model: string, models: ModelProviderConfig[]): ModelType | undefined {
  return models.find((m) => m.model === model)?.type;
}

/** 聚合单元（按模型类型一行） */
export interface BillingRow {
  type: ModelType;
  /** 该类型下的模型展示名（取最新一条消息的） */
  model?: string;
  /** 参与聚合的消息条数 */
  count: number;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    totalTokens: number;
    cost: number;
  };
}

const EMPTY_USAGE: BillingRow["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  totalTokens: 0,
  cost: 0,
};

function rowOfType(type: ModelType, model?: string): BillingRow {
  return { type, model, count: 0, usage: { ...EMPTY_USAGE } };
}

/**
 * 聚合当前会话所有 assistant 消息的 usage/cost，按模型类型分组。
 * 仅统计带 usage 的消息；cost 无则计 0（>0 才展示）。
 */
export function aggregateBilling(
  messages: ChatMessage[],
  models: ModelProviderConfig[],
): BillingRow[] {
  const rows = new Map<ModelType, BillingRow>();
  for (const m of messages) {
    if (m.role !== "assistant" || !m.usage) continue;
    const { type, model } = resolveMessageModel(m.provider, m.model, models);
    if (!type) continue;
    let row = rows.get(type);
    if (!row) {
      row = rowOfType(type, model);
      rows.set(type, row);
    }
    row.count += 1;
    if (model) row.model = model;
    row.usage.input += m.usage.input ?? 0;
    row.usage.output += m.usage.output ?? 0;
    row.usage.cacheRead += m.usage.cacheRead ?? 0;
    row.usage.totalTokens += m.usage.totalTokens ?? 0;
    row.usage.cost += m.usage.cost?.total ?? 0;
  }
  return [...rows.values()];
}

/** 按消息逐条加和 usage（MessageFooter 单条展示用） */
export function sumUsage(usage: MessageUsage): {
  totalTokens: number;
  cost: number;
} {
  return {
    totalTokens: usage.totalTokens ?? 0,
    cost: usage.cost?.total ?? 0,
  };
}

/** token 数格式化：≥1000 → "1.2k"，否则整数 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

/** 费用格式化：分档精度（≥0.001 → 3 位小数，否则 4 位） */
export function formatCost(c: number): string {
  if (!Number.isFinite(c) || c <= 0) return "¥0";
  return c >= 0.001 ? `¥${c.toFixed(3)}` : `¥${c.toFixed(4)}`;
}

/** 类型标签展示名（llm/vlm/image → 中文） */
export const TYPE_LABELS: Record<ModelType, string> = {
  llm: "对话 LLM",
  vlm: "视觉 VLM",
  image: "生图 Image",
};
