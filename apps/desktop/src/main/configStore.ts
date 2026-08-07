/**
 * 非敏感配置（workspaces + tasks）管理（见 docs/architecture.md §7.3）。
 *
 * 使用 JSON 文件 ~/EveryBuddy/config.json 持久化（替代 electron-store，避免 ESM 互操作问题）。
 * 存储内容（不含模型/密钥——模型配置统一由 modelStore 管理，见 modelStore.ts）：
 *  - workspaces: 工作空间注册表
 *  - tasks: 任务（会话）元数据
 *
 * 模型 provider 配置与 API Key 迁至 pi-ai 原生两件套：models.json（provider 配置）+
 * auth.json（凭证，0600），由 modelStore 读写、ModelRuntime 直接消费。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { TaskMeta, Workspace } from "@everybuddy/ipc-contract";

/** 应用根目录 ~/EveryBuddy */
export const APP_ROOT = path.join(homedir(), "EveryBuddy");
/** 非空间任务会话目录 */
export const SESSIONS_DIR = path.join(APP_ROOT, "sessions");
/** 「新建空间」默认落盘目录 ~/EveryBuddy/work-spaces */
export const WORK_SPACES_DIR = path.join(APP_ROOT, "work-spaces");

/** 确保应用根目录与 sessions 目录存在 */
export function ensureAppDirs(): void {
  if (!existsSync(APP_ROOT)) mkdirSync(APP_ROOT, { recursive: true });
  if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR, { recursive: true });
}

interface ConfigShape {
  workspaces: Workspace[];
  tasks: TaskMeta[];
}

export const CONFIG_PATH = path.join(APP_ROOT, "config.json");

const DEFAULT_CONFIG: ConfigShape = {
  workspaces: [],
  tasks: [],
};

class ConfigStore {
  private data: ConfigShape = { ...DEFAULT_CONFIG };
  private loaded = false;

  private load(): void {
    if (this.loaded) return;
    ensureAppDirs();
    if (existsSync(CONFIG_PATH)) {
      try {
        const raw = readFileSync(CONFIG_PATH, "utf-8");
        const parsed = JSON.parse(raw) as Partial<ConfigShape>;
        this.data = {
          workspaces: parsed.workspaces ?? [],
          tasks: parsed.tasks ?? [],
        };
      } catch {
        this.data = { ...DEFAULT_CONFIG };
      }
    }
    this.loaded = true;
  }

  private save(): void {
    ensureAppDirs();
    writeFileSync(CONFIG_PATH, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ── Workspaces ────────────────────────────

  listWorkspaces(): Workspace[] {
    this.load();
    return this.data.workspaces;
  }

  getWorkspace(id: string): Workspace | undefined {
    this.load();
    return this.data.workspaces.find((w) => w.id === id);
  }

  addWorkspace(name: string, dirPath: string): Workspace {
    this.load();
    const ws: Workspace = {
      id: randomUUID(),
      name,
      path: dirPath,
      createdAt: new Date().toISOString(),
    };
    this.data.workspaces.push(ws);
    this.save();
    return ws;
  }

  removeWorkspace(id: string): void {
    this.load();
    this.data.workspaces = this.data.workspaces.filter((w) => w.id !== id);
    this.save();
  }

  // ── Tasks ─────────────────────────────────

  listTasks(): TaskMeta[] {
    this.load();
    return this.data.tasks;
  }

  addTask(task: TaskMeta): void {
    this.load();
    this.data.tasks.push(task);
    this.save();
  }

  updateTask(id: string, patch: Partial<Omit<TaskMeta, "id">>): void {
    this.load();
    const idx = this.data.tasks.findIndex((t) => t.id === id);
    const existing = idx >= 0 ? this.data.tasks[idx] : undefined;
    if (existing) {
      this.data.tasks[idx] = { ...existing, ...patch };
      this.save();
    }
  }

  removeTask(id: string): void {
    this.load();
    this.data.tasks = this.data.tasks.filter((t) => t.id !== id);
    this.save();
  }

  getTask(id: string): TaskMeta | undefined {
    this.load();
    return this.data.tasks.find((t) => t.id === id);
  }
}

export const configStore = new ConfigStore();
