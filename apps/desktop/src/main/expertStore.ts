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
import type { CreateExpertRequest, Expert, UpdateExpertRequest } from "@everybuddy/ipc-contract";
import type { AgentConfig } from "./agentConfigStore";
import { APP_ROOT, ensureAppDirs } from "./configStore";
import { uiError } from "./errors";
import { buildExpertIdentityPrompt } from "./expertPrompt";

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
  {
    id: "project-coordinator",
    name: "项目协调员",
    icon: "users",
    description: "统筹团队协作，分派子任务给成员并汇总结果",
    mode: "daily",
    tags: ["domain:coordination", "capability:dispatch"],
    source: "builtin",
    createdAt: BUILTIN_AT,
    updatedAt: BUILTIN_AT,
  },
];

export function getBuiltinExpert(id: string): Expert | undefined {
  return BUILTIN_EXPERTS.find((e) => e.id === id);
}

/** 找专家（含内置）：task 选用时先查自定义，再查内置（合并 override） */
export function findExpert(id: string): Expert | undefined {
  const custom = expertStore.getCustom(id);
  return custom ?? expertStore.getBuiltinMerged(id);
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
  // 自定义专家：显式工具选择即权威工具集（空 = 仅保留基础附件解析），不再追加平台全量；
  // 内置专家保持「模式默认 ∪ override 追加」的既有语义
  if (expert.source === "custom" && expert.tools !== undefined) {
    cfg.tools = expert.tools;
    cfg.restrictTools = true;
  } else if (expert.tools?.length) {
    cfg.tools = [...(base.tools ?? []), ...expert.tools];
  }
  // 扩展同工具：自定义专家显式选择即权威（空 = 不加载 plan-mode/todo 等，避免其注册工具）；
  // 内置专家保持「undefined → 模式默认扩展」的既有语义
  if (expert.source === "custom" && expert.extensions !== undefined) {
    cfg.extensions = expert.extensions;
  } else if (expert.extensions?.length) {
    cfg.extensions = expert.extensions;
  }
  if (expert.defaultModelProviderId) cfg.defaultModelProviderId = expert.defaultModelProviderId;
  if (expert.visionModelProviderId) cfg.visionModelProviderId = expert.visionModelProviderId;
  if (expert.imageGenModelProviderId) cfg.imageGenModelProviderId = expert.imageGenModelProviderId;
  return cfg;
}

interface ExpertShape {
  experts: Expert[];
  /** 内置专家字段级覆盖：key = 内置专家 id（daily/coding），落盘于 experts.json */
  overrides: Record<string, Partial<Expert>>;
}

function emptyShape(): ExpertShape {
  return { experts: [], overrides: {} };
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
        this.data = { experts: parsed.experts ?? [], overrides: parsed.overrides ?? {} };
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

  /** 字段级合并内置专家 + override；名称/图标/mode 恒取 base（锁定），undefined 不覆盖 */
  private mergeBuiltin(base: Expert, override?: Partial<Expert>): Expert {
    return {
      ...base,
      description: override?.description ?? base.description,
      systemPrompt: override?.systemPrompt,
      appendSystemPrompt: override?.appendSystemPrompt,
      tools: override?.tools,
      extensions: override?.extensions,
      tags: override?.tags ?? base.tags,
      updatedAt: override?.updatedAt ?? base.updatedAt,
    };
  }

  /** 内置专家合并本地 override 后的视图（无 override 即 base 本身） */
  getBuiltinMerged(id: string): Expert | undefined {
    const base = getBuiltinExpert(id);
    if (!base) return undefined;
    this.load();
    return this.mergeBuiltin(base, this.data.overrides[id]);
  }

  /** builtin（合并 override）+ 自定义合并列表（builtin 在前） */
  list(): Expert[] {
    this.load();
    return [
      ...BUILTIN_EXPERTS.map((e) => this.mergeBuiltin(e, this.data.overrides[e.id])),
      ...this.data.experts,
    ];
  }

  listCustom(): Expert[] {
    this.load();
    return this.data.experts;
  }

  create(req: CreateExpertRequest): Expert {
    this.load();
    const now = new Date().toISOString();
    // 自定义专家：未填系统提示词（或纯空白）→ 按名称+描述自动生成人格提示词，不再静默回落模式默认
    const sys = req.systemPrompt?.trim();
    const expert: Expert = {
      id: randomUUID(),
      name: req.name,
      icon: req.icon ?? "briefcase",
      description: req.description ?? "",
      mode: req.mode ?? "daily",
      systemPrompt: sys ? sys : buildExpertIdentityPrompt(req.name, req.description ?? ""),
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
    // 内置专家写 override（名称/图标/mode 锁定）；custom 正常合并
    const base = getBuiltinExpert(req.id);
    if (base) return this.updateBuiltin(base, req);
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
          ? (req.defaultModelProviderId ?? undefined)
          : existing.defaultModelProviderId,
      visionModelProviderId:
        req.visionModelProviderId !== undefined
          ? (req.visionModelProviderId ?? undefined)
          : existing.visionModelProviderId,
      imageGenModelProviderId:
        req.imageGenModelProviderId !== undefined
          ? (req.imageGenModelProviderId ?? undefined)
          : existing.imageGenModelProviderId,
      tags: req.tags ?? existing.tags,
      updatedAt: new Date().toISOString(),
    };
    // 自定义专家：名称/描述变更且 systemPrompt 仍是「自动生成的人格提示词」→ 随之重新生成；
    // 用户显式编辑过提示词（≠ 旧自动文案）则不覆盖，尊重用户内容。
    if (existing.source === "custom") {
      const oldAuto = buildExpertIdentityPrompt(existing.name, existing.description ?? "");
      const stillAuto = !existing.systemPrompt || existing.systemPrompt === oldAuto;
      const promptUnchanged = req.systemPrompt === undefined || req.systemPrompt === oldAuto;
      const nameChanged = req.name !== undefined && req.name !== existing.name;
      const descChanged = req.description !== undefined && req.description !== existing.description;
      if (stillAuto && promptUnchanged && (nameChanged || descChanged)) {
        merged.systemPrompt = buildExpertIdentityPrompt(
          req.name ?? existing.name,
          req.description ?? existing.description ?? "",
        );
      }
    }
    this.data.experts[idx] = merged;
    this.save();
    return merged;
  }

  /** 内置专家更新：字段级写 override；空串 systemPrompt=清除覆盖；空记录删除 override 条目 */
  private updateBuiltin(base: Expert, req: UpdateExpertRequest): Expert {
    this.load();
    const prev = this.data.overrides[base.id] ?? {};
    const next: Partial<Expert> = { ...prev, updatedAt: new Date().toISOString() };
    if (req.description !== undefined) next.description = req.description;
    if (req.systemPrompt !== undefined)
      next.systemPrompt = req.systemPrompt === "" ? undefined : req.systemPrompt;
    if (req.appendSystemPrompt !== undefined) next.appendSystemPrompt = req.appendSystemPrompt;
    if (req.tools !== undefined) next.tools = req.tools;
    if (req.extensions !== undefined) next.extensions = req.extensions;
    if (req.tags !== undefined) next.tags = req.tags;
    // 剔除 undefined 使记录最小；空记录删除整条 override（等价重置该字段）
    const clean: Partial<Expert> = {};
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined) clean[k as keyof Expert] = v as never;
    }
    if (Object.keys(clean).length > 0) this.data.overrides[base.id] = clean;
    else delete this.data.overrides[base.id];
    this.save();
    return this.mergeBuiltin(base, this.data.overrides[base.id]);
  }

  /** 重置内置专家：删除 override，回退模式默认（main/prompts/*.ts builder） */
  reset(id: string): Expert {
    if (!getBuiltinExpert(id)) {
      throw uiError("errors.expertResetBuiltinOnly");
    }
    this.load();
    delete this.data.overrides[id];
    this.save();
    const base = getBuiltinExpert(id) as Expert;
    return { ...base };
  }

  /** 仅自定义可删；内置删除抛错 */
  delete(id: string): void {
    if (getBuiltinExpert(id)) {
      throw uiError("errors.expertDeleteBuiltinOnly");
    }
    this.load();
    this.data.experts = this.data.experts.filter((e) => e.id !== id);
    this.save();
  }
}

export const expertStore = new ExpertStore();
