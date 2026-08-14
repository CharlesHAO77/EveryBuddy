/**
 * expertStore - 专家注册表（~/EveryBuddy/experts.json + 内置专家 const）。
 *
 * 与 configStore / schedulerStore 同一模式：JSON 文件落盘 + 可注入路径（单测用临时目录）。
 *  - 内置专家（daily/coding）= 现有两种 agent 模式平移，代码内 const，不落盘，不可删。
 *  - 自定义专家落 experts.json；从内置复制或从零创建。
 *  - Expert → AgentConfig 映射集中在此（§5），agentRuntime 消费时按 task.expertId 解析。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  CreateExpertRequest,
  Expert,
  UpdateExpertRequest,
} from "@everybuddy/ipc-contract";
import type { AgentConfig } from "./agentConfigStore";
import { APP_ROOT, ensureAppDirs } from "./configStore";

export const EXPERTS_PATH = path.join(APP_ROOT, "experts.json");

const BUILTIN_AT = "2026-01-01T00:00:00.000Z";

/** 内置专家：现有 daily/coding 模式平移（零行为变更，task 无 expertId 时按 mode 回退到它们） */
export const BUILTIN_EXPERTS: Expert[] = [
  {
    id: "daily",
    name: "办公助理",
    icon: "briefcase",
    description: "文档解析与撰写、信息整理、表格与数据处理",
    mode: "daily",
    tags: ["domain:office", "capability:vision"],
    source: "builtin",
    createdAt: BUILTIN_AT,
    updatedAt: BUILTIN_AT,
  },
  {
    id: "coding",
    name: "编码助手",
    icon: "code",
    description: "读取与修改代码、执行命令、完成开发任务",
    mode: "coding",
    tags: ["domain:dev", "capability:code"],
    source: "builtin",
    createdAt: BUILTIN_AT,
    updatedAt: BUILTIN_AT,
  },
];

export function getBuiltinExpert(id: string): Expert | undefined {
  return BUILTIN_EXPERTS.find((e) => e.id === id);
}

/** 找专家（含内置）：task 选用时先查自定义，再查内置 */
export function findExpert(id: string): Expert | undefined {
  const custom = expertStore.getCustom(id);
  return custom ?? getBuiltinExpert(id);
}

/**
 * Expert → AgentConfig 映射（§5 单点）。
 * custom 专家以所属模式的基础配置为底，叠加覆盖字段；builtin 专家即基础配置本身。
 * 返回浅拷贝，不改动 base。
 */
export function expertToAgentConfig(expert: Expert, base: AgentConfig): AgentConfig {
  const cfg: AgentConfig = { ...base };
  if (expert.systemPrompt) cfg.systemPrompt = expert.systemPrompt;
  if (expert.appendSystemPrompt?.length) cfg.appendSystemPrompt = expert.appendSystemPrompt;
  if (expert.tools?.length) cfg.tools = [...(base.tools ?? []), ...expert.tools];
  if (expert.extensions?.length) cfg.extensions = expert.extensions;
  if (expert.defaultModelProviderId) cfg.defaultModelProviderId = expert.defaultModelProviderId;
  if (expert.visionModelProviderId) cfg.visionModelProviderId = expert.visionModelProviderId;
  if (expert.imageGenModelProviderId) cfg.imageGenModelProviderId = expert.imageGenModelProviderId;
  return cfg;
}

interface ExpertShape {
  experts: Expert[];
}

function emptyShape(): ExpertShape {
  return { experts: [] };
}

export class ExpertStore {
  private data: ExpertShape = emptyShape();
  private loaded = false;

  constructor(private filePath: string = EXPERTS_PATH) {}

  private load(): void {
    if (this.loaded) return;
    ensureAppDirs();
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<ExpertShape>;
        this.data = { experts: parsed.experts ?? [] };
      } catch {
        this.data = emptyShape();
      }
    }
    this.loaded = true;
  }

  private save(): void {
    ensureAppDirs();
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  getCustom(id: string): Expert | undefined {
    this.load();
    return this.data.experts.find((e) => e.id === id);
  }

  /** builtin + 自定义合并列表（builtin 在前） */
  list(): Expert[] {
    return [...BUILTIN_EXPERTS, ...this.listCustom()];
  }

  listCustom(): Expert[] {
    this.load();
    return this.data.experts;
  }

  create(req: CreateExpertRequest): Expert {
    this.load();
    const now = new Date().toISOString();
    const expert: Expert = {
      id: randomUUID(),
      name: req.name,
      icon: req.icon ?? "briefcase",
      description: req.description ?? "",
      mode: req.mode ?? "daily",
      systemPrompt: req.systemPrompt,
      appendSystemPrompt: req.appendSystemPrompt,
      tools: req.tools,
      extensions: req.extensions,
      defaultModelProviderId: req.defaultModelProviderId,
      visionModelProviderId: req.visionModelProviderId,
      imageGenModelProviderId: req.imageGenModelProviderId,
      tags: req.tags ?? [],
      source: "custom",
      createdAt: now,
      updatedAt: now,
    };
    this.data.experts.push(expert);
    this.save();
    return expert;
  }

  update(req: UpdateExpertRequest): Expert | undefined {
    // 内置专家结构不可改（仅展示/复制为自定义），避免与 agent-*.json 双写漂移
    if (getBuiltinExpert(req.id)) {
      throw new Error("内置专家不可直接编辑，请「复制为自定义」后修改");
    }
    this.load();
    const idx = this.data.experts.findIndex((e) => e.id === req.id);
    const existing = this.data.experts[idx];
    if (!existing) return undefined;
    const merged: Expert = {
      ...existing,
      name: req.name ?? existing.name,
      icon: req.icon ?? existing.icon,
      description: req.description ?? existing.description,
      mode: req.mode ?? existing.mode,
      systemPrompt: req.systemPrompt !== undefined ? req.systemPrompt : existing.systemPrompt,
      appendSystemPrompt:
        req.appendSystemPrompt !== undefined ? req.appendSystemPrompt : existing.appendSystemPrompt,
      tools: req.tools !== undefined ? req.tools : existing.tools,
      extensions: req.extensions !== undefined ? req.extensions : existing.extensions,
      defaultModelProviderId:
        req.defaultModelProviderId !== undefined
          ? req.defaultModelProviderId ?? undefined
          : existing.defaultModelProviderId,
      visionModelProviderId:
        req.visionModelProviderId !== undefined
          ? req.visionModelProviderId ?? undefined
          : existing.visionModelProviderId,
      imageGenModelProviderId:
        req.imageGenModelProviderId !== undefined
          ? req.imageGenModelProviderId ?? undefined
          : existing.imageGenModelProviderId,
      tags: req.tags ?? existing.tags,
      updatedAt: new Date().toISOString(),
    };
    this.data.experts[idx] = merged;
    this.save();
    return merged;
  }

  /** 仅自定义可删；内置删除抛错 */
  delete(id: string): void {
    if (getBuiltinExpert(id)) {
      throw new Error("内置专家不可删除");
    }
    this.load();
    this.data.experts = this.data.experts.filter((e) => e.id !== id);
    this.save();
  }
}

export const expertStore = new ExpertStore();
