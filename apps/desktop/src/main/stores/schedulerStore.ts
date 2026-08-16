/**
 * 自动化（定时任务）存储 - ~/EveryBuddy/schedule.json（见 docs/architecture.md §7.3 模式）。
 *
 * 同步 JSON 读写（替代 electron-store，与 configStore 一致）：
 *  - tasks: 定时任务定义
 *  - runs:  执行历史（每任务封顶 50 条，防无限增长）
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ScheduledRun, ScheduledTask } from "@everybuddy/ipc-contract";
import { APP_ROOT, ensureAppDirs } from "./configStore";

export const SCHEDULE_PATH = path.join(APP_ROOT, "schedule.json");

/** 每任务最多保留的运行记录条数 */
export const MAX_RUNS_PER_TASK = 50;

interface ScheduleShape {
  tasks: ScheduledTask[];
  runs: ScheduledRun[];
}

/** 每次返回全新数组（避免浅拷贝共享引用导致跨实例污染） */
function emptyShape(): ScheduleShape {
  return { tasks: [], runs: [] };
}

export class SchedulerStore {
  private data: ScheduleShape = emptyShape();
  private loaded = false;

  constructor(private filePath: string = SCHEDULE_PATH) {}

  private load(): void {
    if (this.loaded) return;
    ensureAppDirs();
    if (existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<ScheduleShape>;
        this.data = {
          tasks: parsed.tasks ?? [],
          runs: parsed.runs ?? [],
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

  // ── Tasks ─────────────────────────────────

  listTasks(): ScheduledTask[] {
    this.load();
    return this.data.tasks;
  }

  getTask(id: string): ScheduledTask | undefined {
    this.load();
    return this.data.tasks.find((t) => t.id === id);
  }

  createTask(input: Omit<ScheduledTask, "id" | "createdAt" | "updatedAt">): ScheduledTask {
    this.load();
    const now = new Date().toISOString();
    const task: ScheduledTask = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.data.tasks.push(task);
    this.save();
    return task;
  }

  updateTask(id: string, patch: Partial<Omit<ScheduledTask, "id">>): ScheduledTask | undefined {
    this.load();
    const existing = this.data.tasks.find((t) => t.id === id);
    if (!existing) return undefined;
    const merged: ScheduledTask = {
      ...existing,
      ...patch,
      id: existing.id,
      updatedAt: new Date().toISOString(),
    };
    this.data.tasks = this.data.tasks.map((t) => (t.id === id ? merged : t));
    this.save();
    return merged;
  }

  removeTask(id: string): void {
    this.load();
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.save();
  }

  // ── Runs ─────────────────────────────────

  /** 某任务全部运行历史（新 → 旧） */
  listRuns(taskId: string): ScheduledRun[] {
    this.load();
    return this.data.runs
      .filter((r) => r.taskId === taskId)
      .sort((a, b) => ((a.startedAt ?? "") < (b.startedAt ?? "") ? 1 : -1));
  }

  appendRun(run: ScheduledRun): void {
    this.load();
    this.data.runs.push(run);
    this.capRuns(run.taskId);
    this.save();
  }

  updateRun(id: string, patch: Partial<Omit<ScheduledRun, "id">>): void {
    this.load();
    const existing = this.data.runs.find((r) => r.id === id);
    if (!existing) return;
    const merged: ScheduledRun = { ...existing, ...patch, id: existing.id };
    this.data.runs = this.data.runs.map((r) => (r.id === id ? merged : r));
    this.save();
  }

  removeRunsForTask(taskId: string): void {
    this.load();
    this.data.runs = this.data.runs.filter((r) => r.taskId !== taskId);
    this.save();
  }

  /** 每任务最多保留 keep 条（丢弃最旧） */
  private capRuns(taskId: string, keep = MAX_RUNS_PER_TASK): void {
    const owned = this.data.runs.filter((r) => r.taskId === taskId);
    if (owned.length <= keep) return;
    const drop = new Set(
      owned
        .slice()
        .sort((a, b) => ((a.startedAt ?? "") < (b.startedAt ?? "") ? 1 : -1))
        .slice(keep)
        .map((r) => r.id),
    );
    this.data.runs = this.data.runs.filter((r) => !drop.has(r.id));
  }
}

export const schedulerStore = new SchedulerStore();
