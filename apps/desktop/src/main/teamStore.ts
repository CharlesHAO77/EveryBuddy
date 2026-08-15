/**
 * teamStore - 专家团注册表（~/EveryBuddy/teams.json + 内置示例团队 const）。
 *
 * 与 expertStore 同一模式：JSON 文件落盘 + 可注入路径（单测用临时目录）。
 *  - 内置示例团队（builtin）= 代码内 const，不落盘，只读 + 可「复制为自定义」。
 *  - 自定义团队落 teams.json。
 *  - routingStrategy: manual（手动切换）/ auto（子 Agent 调度）/ workflow（代码流程编排）。
 *    runtime 消费方（teamRuntime）按 teamId 解析，见 agentRuntime.createTaskSession。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CreateTeamRequest, ExpertTeam, UpdateTeamRequest } from "@everybuddy/ipc-contract";
import { APP_ROOT, ensureAppDirs } from "./configStore";

export const TEAMS_PATH = path.join(APP_ROOT, "teams.json");

/** 内置示例团队时间戳（不落盘，仅占位） */
const BUILTIN_AT = "2026-01-01T00:00:00.000Z";

/**
 * 内置示例团队（代码内 const，不落盘）。
 * 成员复用内置专家（daily 办公助理 / coding 编码助手，恒存在），无需新建示例专家。
 *  - team-example-dispatcher：subagent-as-tools（auto）演示——coordinator 自动 delegate 并行调度。
 *  - team-example-workflow：workflow 编排演示——需求→设计→编码→评审 确定性流水线。
 */
export const BUILTIN_TEAMS: ExpertTeam[] = [
  {
    id: "team-example-dispatcher",
    name: "团队协作",
    icon: "bot",
    description: "主 Agent 自动分派子任务给办公/编码两位专家，并行协作后汇总",
    expertIds: ["daily", "coding"],
    leadExpertId: "project-coordinator",
    roles: { "project-coordinator": "协调者", daily: "办公执行", coding: "编码执行" },
    tags: ["source:builtin", "capability:dispatch"],
    routingStrategy: "auto",
    source: "builtin",
    createdAt: BUILTIN_AT,
    updatedAt: BUILTIN_AT,
  },
  {
    id: "team-example-workflow",
    name: "软件研发",
    icon: "workflow",
    description: "需求分析 → 方案设计 → 编码实现 → 质量评审 的确定性流水线",
    expertIds: ["daily", "coding"],
    roles: { daily: "需求分析 / 评审", coding: "设计 / 编码" },
    tags: ["source:builtin", "capability:workflow"],
    routingStrategy: "workflow",
    workflow: {
      id: "wf-example-dev",
      name: "需求 → 设计 → 编码 → 评审",
      description: "分析需求 → 设计技术方案 → 实现代码 → 质量评审，最后汇总",
      steps: [
        {
          kind: "serial",
          id: "analysis",
          expertId: "daily",
          prompt: "你是需求分析师：针对「{user}」，澄清并输出需求要点与验收标准，保持简洁结构化。",
        },
        {
          kind: "serial",
          id: "design",
          expertId: "coding",
          prompt:
            "你是方案设计师：基于上一步结论 {{analysis.result}}，输出技术方案、模块划分与任务拆解。",
        },
        {
          kind: "serial",
          id: "implement",
          expertId: "coding",
          prompt:
            "你是编码专家：按方案 {{design.result}} 实现，直接在当前工作区落地代码，给出改动文件清单与运行说明。",
        },
        {
          kind: "serial",
          id: "review",
          expertId: "daily",
          prompt:
            "你是质量评审：审查 {{implement.result}} 的产出，给出问题清单、风险与改进建议，明确是否通过。",
        },
      ],
      summarizerExpertId: "daily",
    },
    source: "builtin",
    createdAt: BUILTIN_AT,
    updatedAt: BUILTIN_AT,
  },
];

/** 按 id 取内置示例团队 */
export function getBuiltinTeam(id: string): ExpertTeam | undefined {
  return BUILTIN_TEAMS.find((t) => t.id === id);
}

interface TeamShape {
  teams: ExpertTeam[];
}

function emptyShape(): TeamShape {
  return { teams: [] };
}

export class TeamStore {
  private data: TeamShape = emptyShape();
  private loaded = false;

  constructor(private filePath: string = TEAMS_PATH) {}

  private load(): void {
    if (this.loaded) return;
    ensureAppDirs();
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as Partial<TeamShape>;
        this.data = {
          // 旧条目缺 source（激活前 schema）：缺省 "custom"，零迁移
          teams: (parsed.teams ?? []).map((t) => ({
            ...t,
            source: t.source ?? ("custom" as const),
          })),
        };
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

  /** 合并列表：内置示例在前 + 自定义 */
  list(): ExpertTeam[] {
    this.load();
    return [...BUILTIN_TEAMS, ...this.data.teams];
  }

  /** 内置示例团队列表（来源徽章展示用） */
  listBuiltin(): ExpertTeam[] {
    return BUILTIN_TEAMS;
  }

  /** 找团队：内置优先，其次自定义 */
  get(id: string): ExpertTeam | undefined {
    const builtin = getBuiltinTeam(id);
    if (builtin) return builtin;
    this.load();
    return this.data.teams.find((t) => t.id === id);
  }

  /** 仅自定义列表（编辑表单用；内置不展示在可编辑列表） */
  listCustom(): ExpertTeam[] {
    this.load();
    return this.data.teams;
  }

  /** 是否内置示例团队 */
  isBuiltin(id: string): boolean {
    return BUILTIN_TEAMS.some((t) => t.id === id);
  }

  create(req: CreateTeamRequest): ExpertTeam {
    this.load();
    const now = new Date().toISOString();
    const team: ExpertTeam = {
      id: randomUUID(),
      name: req.name,
      icon: req.icon ?? "users",
      description: req.description ?? "",
      expertIds: req.expertIds ?? [],
      leadExpertId: req.leadExpertId,
      roles: req.roles,
      tags: req.tags ?? [],
      routingStrategy: req.routingStrategy ?? "manual",
      sharedTools: req.sharedTools,
      sharedExtensions: req.sharedExtensions,
      workflow: req.workflow,
      source: "custom",
      createdAt: now,
      updatedAt: now,
    };
    this.data.teams.push(team);
    this.save();
    return team;
  }

  /** 复制为自定义：从任意团队（含内置）生成一份 custom 副本（含 workflow 字面量 / 主 agent / 角色），返回新团队 */
  duplicateAsCustom(id: string): ExpertTeam {
    const src = this.get(id);
    if (!src) throw new Error("团队不存在");
    return this.create({
      name: `${src.name} · 副本`,
      icon: src.icon,
      description: src.description,
      expertIds: src.expertIds,
      leadExpertId: src.leadExpertId,
      roles: src.roles,
      tags: src.tags,
      routingStrategy: src.routingStrategy,
      sharedTools: src.sharedTools,
      sharedExtensions: src.sharedExtensions,
      workflow: src.workflow,
    });
  }

  /** 更新自定义团队；内置团队不可编辑（先复制为自定义） */
  update(req: UpdateTeamRequest): ExpertTeam | undefined {
    if (this.isBuiltin(req.id)) {
      throw new Error("内置团队为只读示例，请先复制为自定义再编辑");
    }
    this.load();
    const idx = this.data.teams.findIndex((t) => t.id === req.id);
    const existing = this.data.teams[idx];
    if (!existing) return undefined;
    const merged: ExpertTeam = {
      ...existing,
      name: req.name ?? existing.name,
      icon: req.icon ?? existing.icon,
      description: req.description ?? existing.description,
      expertIds: req.expertIds ?? existing.expertIds,
      leadExpertId:
        req.leadExpertId !== undefined ? (req.leadExpertId ?? undefined) : existing.leadExpertId,
      roles: req.roles !== undefined ? (req.roles ?? undefined) : existing.roles,
      tags: req.tags ?? existing.tags,
      routingStrategy: req.routingStrategy ?? existing.routingStrategy,
      sharedTools:
        req.sharedTools !== undefined ? (req.sharedTools ?? undefined) : existing.sharedTools,
      sharedExtensions:
        req.sharedExtensions !== undefined
          ? (req.sharedExtensions ?? undefined)
          : existing.sharedExtensions,
      workflow: req.workflow !== undefined ? (req.workflow ?? undefined) : existing.workflow,
      updatedAt: new Date().toISOString(),
    };
    this.data.teams[idx] = merged;
    this.save();
    return merged;
  }

  /** 删除自定义团队；内置团队不可删 */
  delete(id: string): void {
    if (this.isBuiltin(id)) {
      throw new Error("内置团队不可删除");
    }
    this.load();
    this.data.teams = this.data.teams.filter((t) => t.id !== id);
    this.save();
  }
}

export const teamStore = new TeamStore();
