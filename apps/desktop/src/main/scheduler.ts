/**
 * 自动化调度引擎（无 electron/SDK import，依赖注入，可单测）。
 *
 * 职责：
 *  1. 为每个启用任务计算下一次触发时间（cron 用 cron-parser，一次性用 runAt）并 setTimeout 到点触发
 *  2. 串行执行队列：同时最多一个运行；cron 触发 FIFO，立即执行（runNow）插队
 *  3. 每次触发合成「隐藏 TaskMeta」（不进 configStore，不污染侧栏任务列表），经 agentRuntime 创建会话并 prompt，
 *     订阅事件流采集结果（text 累加 + usage 汇总），agent_settled 定案
 *  4. 运行记录持久化到 schedulerStore，事件经 setEventEmitter 推给渲染进程，完成时（焦点外）系统通知
 *
 * 边界：关闭期间错过的周期不补跑；过期的一次性任务记 skipped 并停用；重启时孤儿 running 记为 cancelled；
 * 卡死运行由看门狗 abort（→ cancelled）；会话/工作目录跑完即清理 + 启动时孤儿目录清扫。
 */

import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import type {
  CreateScheduleTaskRequest,
  MessageUsage,
  ScheduledRun,
  ScheduledTask,
  ScheduleEvent,
  ScheduleSpecZ,
  TaskMeta,
  UpdateScheduleTaskRequest,
} from "@everybuddy/ipc-contract";
import { CronExpressionParser } from "cron-parser";
import type { agentRuntime } from "./agentRuntime";
import { configStore, SESSIONS_DIR, WORK_SPACES_DIR } from "./configStore";
import { rmIfDirectChild } from "./dirCleanup";
import { uiError } from "./errors";
import { type SchedulerStore, schedulerStore } from "./schedulerStore";
import { resolveSessionLocation } from "./sessionDirs";

/** 单次运行最长时间（看门狗，超时 abort 防饿死队列） */
const MAX_RUN_MS = 60 * 60 * 1000;
/** 结果文本截断长度 */
const RESULT_CAP = 4000;
/** setTimeout 最大延迟（~24.8 天），超过需重 arm（每月任务） */
const MAX_TIMEOUT_MS = 0x7fffffff;
/** sessions 下 datetime 目录名模式（孤儿清扫仅匹配该模式） */
const DATETIME_DIR_RE = /^\d{4}-\d{2}-\d{2}_\d{6}-[0-9a-f]{4}$/;

type SchedulerRuntime = Pick<
  typeof agentRuntime,
  "createTaskSession" | "prompt" | "abort" | "disposeSession" | "onEvent"
>;

interface QueueItem {
  taskId: string;
  /** 入队时快照（运行中编辑不影响在途运行） */
  prompt: string;
  mode: "daily" | "coding";
  providerId?: string;
  /** true = 立即执行（插队；不影响周期调度） */
  manual: boolean;
}

/** 结果文本截断 */
export function truncate(text: string, cap = RESULT_CAP): string {
  if (text.length <= cap) return text;
  return `${text.slice(0, cap)}\n…（结果过长，已截断）`;
}

/** 累加 MessageUsage（跨多条 assistant 消息汇总本次运行用量/费用） */
export function addUsage(acc: MessageUsage | null, u: MessageUsage): MessageUsage {
  const base = acc ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
  const cost = (c?: { input?: number; output?: number; total?: number }) => ({
    input: (c?.input ?? 0) + (u.cost?.input ?? 0),
    output: (c?.output ?? 0) + (u.cost?.output ?? 0),
    total: (c?.total ?? 0) + (u.cost?.total ?? 0),
  });
  return {
    input: base.input + (u.input ?? 0),
    output: base.output + (u.output ?? 0),
    cacheRead: base.cacheRead + (u.cacheRead ?? 0),
    cacheWrite: base.cacheWrite + (u.cacheWrite ?? 0),
    totalTokens: base.totalTokens + (u.totalTokens ?? 0),
    reasoning: u.reasoning !== undefined ? (base.reasoning ?? 0) + u.reasoning : base.reasoning,
    cost: u.cost ? cost(base.cost) : base.cost,
  };
}

export class Scheduler {
  private store: SchedulerStore;
  private now: () => Date;
  private resolveSessionDir: () => { sessionDir: string; workDir?: string };

  private runtime: SchedulerRuntime | null = null;
  private notify: (title: string, body: string) => void = () => {};
  private isWindowFocused: () => boolean = () => true;
  private eventEmitter: ((event: ScheduleEvent) => void) | null = null;

  private timers = new Map<string, NodeJS.Timeout>();
  private queue: QueueItem[] = [];
  private draining = false;
  private stopped = false;
  private currentRun: { runId: string; taskId: string } | null = null;

  constructor(
    opts: {
      store?: SchedulerStore;
      now?: () => Date;
      resolveSessionDir?: () => { sessionDir: string; workDir?: string };
    } = {},
  ) {
    this.store = opts.store ?? schedulerStore;
    this.now = opts.now ?? (() => new Date());
    this.resolveSessionDir =
      opts.resolveSessionDir ?? (() => resolveSessionLocation("temp", undefined));
  }

  /** 注入运行时与平台能力（生产在 app.ts/ipcRouter 调用；测试注入 fake） */
  wire(deps: {
    runtime: SchedulerRuntime;
    notify: (title: string, body: string) => void;
    isWindowFocused: () => boolean;
  }): void {
    this.runtime = deps.runtime;
    this.notify = deps.notify;
    this.isWindowFocused = deps.isWindowFocused;
  }

  /** 推送调度事件（ipcRouter 接为 webContents.send("schedule:event", e)） */
  setEventEmitter(fn: (event: ScheduleEvent) => void): void {
    this.eventEmitter = fn;
  }

  private emit(event: ScheduleEvent): void {
    if (this.eventEmitter) {
      try {
        this.eventEmitter(event);
      } catch (err) {
        console.error("[scheduler] 事件推送失败:", err);
      }
    }
  }

  // ── 生命周期 ─────────────────────────────

  /** 启动：孤儿 run 恢复 → 孤儿会话目录清扫 → 逐任务 arm（过期 once 记 skipped 并停用） */
  async init(): Promise<void> {
    const nowIso = this.now().toISOString();

    for (const task of this.store.listTasks()) {
      for (const run of this.store.listRuns(task.id)) {
        if (run.status === "running") {
          this.store.updateRun(run.id, {
            status: "cancelled",
            finishedAt: nowIso,
            error: "应用退出导致中断",
          });
        }
      }
    }

    await this.sweepOrphanSessions();

    for (const task of this.store.listTasks()) {
      if (!task.spec) {
        // 损坏数据（旧 bug 曾清空 spec）：停用且不调度
        console.warn(`[scheduler] 任务 ${task.id} 缺少调度规则，已停用`);
        this.store.updateTask(task.id, { enabled: false, nextRunAt: undefined });
        continue;
      }
      if (task.spec.type === "once" && task.enabled && this.nextOccurrence(task) === null) {
        // 从未运行且 runAt 已过：记 skipped + 停用（不补跑）
        this.store.updateTask(task.id, {
          enabled: false,
          nextRunAt: undefined,
          lastStatus: "skipped",
        });
        this.store.appendRun({
          id: randomUUID(),
          taskId: task.id,
          status: "skipped",
          finishedAt: nowIso,
          error: "任务过期未执行",
        });
        continue;
      }
      this.arm(task);
    }
  }

  /** 退出：清定时器 + 在途 run 记为 cancelled（同步落盘，before-quit 不可 await） */
  stop(): void {
    this.stopped = true;
    for (const [, timer] of this.timers) clearTimeout(timer);
    this.timers.clear();
    if (this.currentRun) {
      this.store.updateRun(this.currentRun.runId, {
        status: "cancelled",
        finishedAt: this.now().toISOString(),
        error: "应用退出导致中断",
      });
      this.currentRun = null;
    }
  }

  // ── CRUD ─────────────────────────────────

  async createTask(input: CreateScheduleTaskRequest): Promise<ScheduledTask> {
    this.validateSpec(input.spec);
    const task = this.store.createTask({
      title: input.title.trim(),
      prompt: input.prompt.trim(),
      spec: input.spec,
      mode: input.mode ?? "daily",
      providerId: input.providerId,
      enabled: true,
      notify: input.notify ?? true,
    });
    this.arm(task);
    this.emit({ type: "task_updated", payload: { task } });
    return task;
  }

  async updateTask(id: string, patch: UpdateScheduleTaskRequest): Promise<ScheduledTask> {
    if (!this.store.getTask(id)) throw uiError("errors.taskNotFound");
    if (patch.spec) this.validateSpec(patch.spec);
    // 仅覆盖显式提供的字段（undefined 视为不修改），避免误清空 spec 等
    const updatePatch: Partial<ScheduledTask> = {};
    if (patch.title !== undefined) updatePatch.title = patch.title;
    if (patch.prompt !== undefined) updatePatch.prompt = patch.prompt;
    if (patch.spec !== undefined) updatePatch.spec = patch.spec;
    if (patch.mode !== undefined) updatePatch.mode = patch.mode;
    if (patch.providerId !== undefined) updatePatch.providerId = patch.providerId;
    if (patch.enabled !== undefined) updatePatch.enabled = patch.enabled;
    if (patch.notify !== undefined) updatePatch.notify = patch.notify;
    const updated = this.store.updateTask(id, updatePatch);
    if (!updated) throw uiError("errors.taskNotFound");
    if (patch.spec !== undefined || patch.enabled !== undefined) {
      // 重新 arm：enabled 时算 nextRunAt + 起定时器；停用时清 nextRunAt + 拆定时器
      this.arm(updated);
    }
    this.emit({ type: "task_updated", payload: { task: updated } });
    return updated;
  }

  async deleteTask(id: string): Promise<void> {
    this.disarm(id);
    if (this.currentRun && this.currentRun.taskId === id) {
      try {
        await this.runtime?.abort(this.currentRun.runId);
      } catch {
        // 忽略：在途 run 会经事件流 finalize 为 cancelled
      }
    }
    this.store.removeTask(id);
    this.store.removeRunsForTask(id);
    this.emit({ type: "task_deleted", payload: { id } });
  }

  /** 立即执行一次（测试运行；enabled=false 也可；有在途运行则排队） */
  async runNow(id: string): Promise<void> {
    const task = this.store.getTask(id);
    if (!task) throw uiError("errors.taskNotFound");
    this.enqueue({
      taskId: id,
      prompt: task.prompt,
      mode: task.mode,
      providerId: task.providerId,
      manual: true,
    });
    void this.drain();
  }

  listTasks(): ScheduledTask[] {
    return this.store.listTasks();
  }

  listRuns(taskId: string): ScheduledRun[] {
    return this.store.listRuns(taskId);
  }

  // ── 调度 ─────────────────────────────────

  private arm(task: ScheduledTask): void {
    this.disarm(task.id);
    if (!task.enabled) {
      this.store.updateTask(task.id, { nextRunAt: undefined });
      return;
    }
    const next = this.nextOccurrence(task);
    if (!next) {
      this.store.updateTask(task.id, { nextRunAt: undefined });
      return;
    }
    const targetMs = next.getTime();
    this.store.updateTask(task.id, { nextRunAt: next.toISOString() });
    const delay = Math.min(Math.max(0, targetMs - this.now().getTime()), MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      this.timers.delete(task.id);
      if (this.now().getTime() < targetMs) {
        // setTimeout 上限截断，未到点 → 重新 arm
        const fresh = this.store.getTask(task.id);
        if (fresh) this.arm(fresh);
      } else {
        this.fire(task.id);
      }
    }, delay);
    this.timers.set(task.id, timer);
  }

  private disarm(taskId: string): void {
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  private nextOccurrence(task: ScheduledTask): Date | null {
    if (!task.enabled) return null;
    if (!task.spec) return null; // 损坏数据兜底（旧 bug 曾清空 spec）
    const nowMs = this.now().getTime();
    if (task.spec.type === "once") {
      const at = new Date(task.spec.runAt).getTime();
      return Number.isNaN(at) || at <= nowMs ? null : new Date(at);
    }
    try {
      return new Date(CronExpressionParser.parse(task.spec.cron).next().getTime());
    } catch (err) {
      console.error(`[scheduler] 无效 cron 表达式 "${task.spec.cron}":`, err);
      return null;
    }
  }

  private validateSpec(spec: ScheduleSpecZ): void {
    if (spec.type === "cron") {
      try {
        CronExpressionParser.parse(spec.cron);
      } catch (err) {
        throw new Error(
          `cron 表达式无效: ${spec.cron}（${err instanceof Error ? err.message : String(err)}）`,
        );
      }
    }
  }

  private fire(taskId: string): void {
    this.timers.delete(taskId);
    const task = this.store.getTask(taskId);
    if (!task?.enabled) return;
    this.enqueue({
      taskId,
      prompt: task.prompt,
      mode: task.mode,
      providerId: task.providerId,
      manual: false,
    });
    // 重新 arm：计算下一次触发（once 已过期则清除 nextRunAt）
    this.arm(task);
    void this.drain();
  }

  private enqueue(item: QueueItem): void {
    if (item.manual) this.queue.unshift(item);
    else this.queue.push(item);
  }

  // ── 串行执行队列 ─────────────────────────

  private async drain(): Promise<void> {
    if (this.draining || this.stopped) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        const item = this.queue.shift();
        if (!item) break;
        await this.execute(item);
      }
    } finally {
      this.draining = false;
    }
  }

  private async execute(item: QueueItem): Promise<void> {
    const runId = randomUUID();
    const startedIso = this.now().toISOString();
    const run: ScheduledRun = {
      id: runId,
      taskId: item.taskId,
      status: "running",
      startedAt: startedIso,
    };
    this.store.appendRun(run);
    this.currentRun = { runId, taskId: item.taskId };
    this.emit({ type: "run_started", payload: { run } });

    const dirs = this.resolveSessionDir();
    const meta: TaskMeta = {
      id: runId,
      title: this.store.getTask(item.taskId)?.title ?? item.taskId,
      type: "temp",
      mode: item.mode,
      workDir: dirs.workDir,
      sessionDir: dirs.sessionDir,
      providerId: item.providerId,
      createdAt: startedIso,
      updatedAt: startedIso,
    };

    let resultText = "";
    let usage: MessageUsage | null = null;
    let errorMsg: string | null = null;
    let aborted = false;

    await new Promise<void>((resolve) => {
      let settled = false;
      let unsub: (() => void) | undefined;
      const watchdog = setTimeout(() => {
        aborted = true;
        void this.runtime?.abort(runId);
      }, MAX_RUN_MS);

      const finish = (status: "success" | "failed" | "cancelled"): void => {
        if (settled) return;
        settled = true;
        this.currentRun = null;
        clearTimeout(watchdog);
        const finishedIso = this.now().toISOString();
        const durationMs = Math.max(0, Date.parse(finishedIso) - Date.parse(startedIso));
        const updatedRun: ScheduledRun = {
          ...run,
          status,
          finishedAt: finishedIso,
          durationMs,
          result: resultText ? truncate(resultText) : undefined,
          error: errorMsg ?? undefined,
          usage: usage ?? undefined,
        };
        this.store.updateRun(runId, updatedRun);

        const task = this.store.getTask(item.taskId);
        if (task) {
          const patch: Partial<ScheduledTask> = { lastRunAt: startedIso, lastStatus: status };
          if (!item.manual && task.spec.type === "once") {
            patch.enabled = false;
            patch.nextRunAt = undefined;
          }
          const updatedTask = this.store.updateTask(item.taskId, patch);
          if (updatedTask) {
            this.emit({ type: "run_finished", payload: { run: updatedRun, task: updatedTask } });
            if ((updatedTask.notify ?? true) && !this.isWindowFocused()) {
              const title = `${updatedTask.title} · ${status === "success" ? "已完成" : status === "failed" ? "执行失败" : "已取消"}`;
              const body =
                status === "success"
                  ? (resultText || "运行完成").slice(0, 80)
                  : (errorMsg ?? "未知错误").slice(0, 80);
              this.notify(title, body);
            }
          }
        }

        if (unsub) unsub();
        void this.cleanupRun(runId, meta);
        resolve();
      };

      unsub = this.runtime?.onEvent((event) => {
        if (event.streamId !== runId) return;
        switch (event.type) {
          case "text_delta":
            resultText += event.payload.delta;
            break;
          case "text_end":
            resultText += event.payload.content;
            break;
          case "message_end":
            if (event.payload.usage) usage = addUsage(usage, event.payload.usage);
            break;
          case "error":
            errorMsg = errorMsg ?? event.payload.message;
            break;
          case "agent_settled":
          case "agent_end":
            finish(aborted ? "cancelled" : errorMsg ? "failed" : "success");
            break;
        }
      });

      // 执行：初始化会话 + prompt（事件流驱动最终 finish；初始化失败直接 fail）
      void (async () => {
        try {
          await this.runtime?.createTaskSession(meta, item.providerId);
          await this.runtime?.prompt(runId, item.prompt, item.providerId);
        } catch (err) {
          errorMsg = errorMsg ?? (err instanceof Error ? err.message : String(err));
          finish("failed");
        }
      })();
    });
  }

  private async cleanupRun(runId: string, meta: TaskMeta): Promise<void> {
    try {
      await this.runtime?.disposeSession(runId);
    } catch (err) {
      console.error(`[scheduler] disposeSession ${runId} 失败:`, err);
    }
    await rmIfDirectChild(meta.sessionDir, SESSIONS_DIR, "自动化会话目录");
    if (meta.workDir) await rmIfDirectChild(meta.workDir, WORK_SPACES_DIR, "自动化工作目录");
  }

  // ── 孤儿目录清扫（启动时，仅 sessions 下 datetime 目录且不被任何任务引用） ──

  private async sweepOrphanSessions(): Promise<void> {
    const referenced = new Set<string>();
    for (const t of configStore.listTasks()) {
      if (t.sessionDir) referenced.add(path.basename(t.sessionDir));
    }
    let names: string[];
    try {
      names = readdirSync(SESSIONS_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return;
    }
    for (const name of names) {
      if (!DATETIME_DIR_RE.test(name)) continue;
      if (referenced.has(name)) continue;
      await rmIfDirectChild(path.join(SESSIONS_DIR, name), SESSIONS_DIR, "孤儿会话目录");
    }
  }
}

export const scheduler = new Scheduler();
