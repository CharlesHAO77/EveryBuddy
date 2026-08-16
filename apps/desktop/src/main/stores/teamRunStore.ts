/**
 * teamRunStore - 团队运行记录存储（~/EveryBuddy/team-runs.json）。
 *
 * 持久化子 agent / workflow 的**执行过程**（最终文本 + 工具序列 + 状态 + 用量 + 时间戳），
 * 供重开应用 / 切换任务后追溯（对齐 schedulerStore 模式：JSON 落盘 + 可注入路径）。
 * 记录按 taskId 组织：`subAgents` 存任务下所有子 agent 过程，`workflowRun` 存最近一次 workflow 运行。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SubAgentRunRecord, TeamRunRecord, WorkflowRunRecord } from "@everybuddy/ipc-contract";
import { APP_ROOT, ensureAppDirs } from "./configStore";

export const TEAM_RUNS_PATH = path.join(APP_ROOT, "team-runs.json");

type RunsShape = Record<string, TeamRunRecord>;

function emptyShape(): RunsShape {
  return {};
}

export class TeamRunStore {
  private data: RunsShape = emptyShape();
  private loaded = false;

  constructor(private filePath: string = TEAM_RUNS_PATH) {}

  private load(): void {
    if (this.loaded) return;
    ensureAppDirs();
    if (existsSync(this.filePath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as RunsShape;
        this.data = parsed && typeof parsed === "object" ? parsed : emptyShape();
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

  /** 取某任务的团队运行记录（无则 undefined） */
  get(taskId: string): TeamRunRecord | undefined {
    this.load();
    return this.data[taskId];
  }

  /** 记录一个子 agent 过程（按 subagentId 去重升位，保留 workflowRun） */
  recordSubagent(taskId: string, sub: SubAgentRunRecord): void {
    this.load();
    const prev = this.data[taskId];
    const existing = prev?.subAgents ?? [];
    const idx = existing.findIndex((s) => s.subagentId === sub.subagentId);
    const subAgents =
      idx >= 0
        ? existing.map((s) => (s.subagentId === sub.subagentId ? sub : s))
        : [...existing, sub];
    this.data[taskId] = {
      taskId,
      subAgents,
      workflowRun: prev?.workflowRun,
      updatedAt: Date.now(),
    };
    this.save();
  }

  /** 记录一次 workflow 运行（覆盖最近一次；中途失败也保留已完成步骤） */
  recordWorkflow(taskId: string, run: WorkflowRunRecord): void {
    this.load();
    const prev = this.data[taskId];
    this.data[taskId] = {
      taskId,
      subAgents: prev?.subAgents ?? [],
      workflowRun: run,
      updatedAt: Date.now(),
    };
    this.save();
  }

  /** 任务删除时清理其运行记录 */
  remove(taskId: string): void {
    this.load();
    delete this.data[taskId];
    this.save();
  }
}

export const teamRunStore = new TeamRunStore();
