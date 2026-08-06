/**
 * 非敏感配置 + 模型配置管理（见 docs/architecture.md §7.3）。
 *
 * 使用 JSON 文件 ~/EveryBuddy/config.json 持久化（替代 electron-store，避免 ESM 互操作问题）。
 * 存储内容：
 *  - models: 模型 provider 配置（含 apiKey，仅主进程持有，不回传渲染进程明文）
 *  - workspaces: 工作空间注册表
 *  - tasks: 任务（会话）元数据
 *
 * 安全：getModels() 回传渲染进程时剥离 apiKey，替换为 hasApiKey 标志。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type {
  ModelProviderConfig,
  SaveModelRequest,
  TaskMeta,
  Workspace,
} from "@everybuddy/ipc-contract";

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

interface StoredModel extends SaveModelRequest {
  apiKey: string;
}

interface ConfigShape {
  models: StoredModel[];
  workspaces: Workspace[];
  tasks: TaskMeta[];
}

const CONFIG_PATH = path.join(APP_ROOT, "config.json");

const DEFAULT_CONFIG: ConfigShape = {
  models: [],
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
          models: parsed.models ?? [],
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

  // ── Models ────────────────────────────────

  getModels(): ModelProviderConfig[] {
    this.load();
    return this.data.models.map((m) => ({
      id: m.id,
      name: m.name,
      baseUrl: m.baseUrl,
      model: m.model,
      isOpenAiCompatible: m.isOpenAiCompatible,
      hasApiKey: Boolean(m.apiKey),
    }));
  }

  /** 获取含明文 apiKey 的模型配置（仅主进程内部使用，不回传渲染进程） */
  getStoredModel(id: string): StoredModel | undefined {
    this.load();
    return this.data.models.find((m) => m.id === id);
  }

  saveModel(req: SaveModelRequest): ModelProviderConfig {
    this.load();
    const idx = this.data.models.findIndex((m) => m.id === req.id);
    const existing = idx >= 0 ? this.data.models[idx] : undefined;
    const stored: StoredModel = {
      ...req,
      apiKey: existing?.apiKey ?? "",
    };
    if (idx >= 0) this.data.models[idx] = stored;
    else this.data.models.push(stored);
    this.save();
    return {
      ...req,
      hasApiKey: Boolean(stored.apiKey),
    };
  }

  setApiKey(providerId: string, apiKey: string): void {
    this.load();
    const m = this.data.models.find((x) => x.id === providerId);
    if (!m) throw new Error(`模型不存在: ${providerId}`);
    m.apiKey = apiKey;
    this.save();
  }

  removeModel(id: string): void {
    this.load();
    this.data.models = this.data.models.filter((m) => m.id !== id);
    this.save();
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
