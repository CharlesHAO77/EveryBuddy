/**
 * teamStore - 专家团注册表（~/EveryBuddy/teams.json）。
 *
 * 本轮仅登记成员 + 手动切换（routingStrategy 恒 "manual"）。
 * Agent 团队调度 / Workflow 编排为后续演进，schema 字段（routingStrategy: auto/workflow、
 * sharedTools、sharedExtensions）已预留，激活时零迁移。
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CreateTeamRequest, ExpertTeam, UpdateTeamRequest } from "@everybuddy/ipc-contract";
import { APP_ROOT, ensureAppDirs } from "./configStore";

export const TEAMS_PATH = path.join(APP_ROOT, "teams.json");

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
        this.data = { teams: parsed.teams ?? [] };
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

  list(): ExpertTeam[] {
    this.load();
    return this.data.teams;
  }

  get(id: string): ExpertTeam | undefined {
    this.load();
    return this.data.teams.find((t) => t.id === id);
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
      tags: req.tags ?? [],
      routingStrategy: req.routingStrategy ?? "manual",
      sharedTools: req.sharedTools,
      sharedExtensions: req.sharedExtensions,
      createdAt: now,
      updatedAt: now,
    };
    this.data.teams.push(team);
    this.save();
    return team;
  }

  update(req: UpdateTeamRequest): ExpertTeam | undefined {
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
      tags: req.tags ?? existing.tags,
      routingStrategy: req.routingStrategy ?? existing.routingStrategy,
      sharedTools: req.sharedTools !== undefined ? req.sharedTools ?? undefined : existing.sharedTools,
      sharedExtensions:
        req.sharedExtensions !== undefined ? req.sharedExtensions ?? undefined : existing.sharedExtensions,
      updatedAt: new Date().toISOString(),
    };
    this.data.teams[idx] = merged;
    this.save();
    return merged;
  }

  delete(id: string): void {
    this.load();
    this.data.teams = this.data.teams.filter((t) => t.id !== id);
    this.save();
  }
}

export const teamStore = new TeamStore();
