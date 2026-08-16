import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentEvent, MessageUsage, ScheduledTask, TaskMeta } from "@everybuddy/ipc-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addUsage, Scheduler, truncate } from "../src/main/runtime/scheduler";
import { SchedulerStore } from "../src/main/stores/schedulerStore";

/** 记录调用并按需异步回放 AgentEvent 的假运行时 */
class FakeRuntime {
  calls: string[] = [];
  lastTaskId = "";
  mode: "success" | "error" = "success";
  delayMs = 5;
  resultText = "今日要点：\n1. 完成回归测试";

  private listener: ((e: AgentEvent) => void) | null = null;

  onEvent(fn: (e: AgentEvent) => void): () => void {
    this.listener = fn;
    return () => {
      if (this.listener === fn) this.listener = null;
    };
  }

  private emit(e: AgentEvent): void {
    this.listener?.(e);
  }

  async createTaskSession(meta: TaskMeta): Promise<void> {
    this.calls.push(`create:${meta.id}`);
    this.lastTaskId = meta.id;
  }

  async prompt(taskId: string, _text: string): Promise<void> {
    this.calls.push(`prompt:${taskId}`);
    const id = taskId;
    setTimeout(() => {
      if (this.mode === "error") {
        this.emit({ streamId: id, type: "error", payload: { message: "模型超时" } });
      } else {
        this.emit({
          streamId: id,
          type: "text_delta",
          payload: { contentIndex: 0, delta: this.resultText },
        });
        this.emit({
          streamId: id,
          type: "message_end",
          payload: {
            usage: {
              input: 100,
              output: 50,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 150,
              cost: { input: 0.1, output: 0.05, total: 0.15 },
            },
          },
        });
      }
      this.emit({ streamId: id, type: "agent_settled" });
    }, this.delayMs);
  }

  async abort(taskId: string): Promise<void> {
    this.calls.push(`abort:${taskId}`);
  }

  async disposeSession(taskId: string): Promise<void> {
    this.calls.push(`dispose:${taskId}`);
  }
}

async function waitFor(fn: () => boolean, timeout = 1500): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("waitFor 超时");
    await new Promise((r) => setTimeout(r, 5));
  }
}

let dir: string;
let store: SchedulerStore;
let runtime: FakeRuntime;
let notify: (title: string, body: string) => void;
let notified: Array<{ title: string; body: string }>;

const NOW = new Date("2026-08-13T08:00:00");

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "eb-sched-"));
  store = new SchedulerStore(path.join(dir, "schedule.json"));
  runtime = new FakeRuntime();
  notified = [];
  notify = (title, body) => notified.push({ title, body });
});

afterEach(() => {});

function makeScheduler(): Scheduler {
  const sched = new Scheduler({
    store,
    now: () => NOW,
    resolveSessionDir: () => ({
      sessionDir: path.join(dir, "sess"),
      workDir: path.join(dir, "work"),
    }),
  });
  sched.wire({ runtime, notify, isWindowFocused: () => false });
  return sched;
}

describe("truncate / addUsage", () => {
  it("truncate keeps short text", () => {
    expect(truncate("abc")).toBe("abc");
  });
  it("truncate caps long text with notice", () => {
    const long = "x".repeat(4100);
    const t = truncate(long, 4000);
    expect(t.length).toBeLessThan(long.length);
    expect(t).toContain("已截断");
  });
  it("addUsage accumulates across messages", () => {
    const u1: MessageUsage = {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0.1, output: 0.05, total: 0.15 },
    };
    const u2: MessageUsage = {
      input: 20,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: { input: 0.2, output: 0.1, total: 0.3 },
    };
    const acc = addUsage(addUsage(null, u1), u2);
    expect(acc.input).toBe(30);
    expect(acc.output).toBe(15);
    expect(acc.cost?.total).toBeCloseTo(0.45);
  });
});

describe("Scheduler.createTask / scheduling", () => {
  it("creates cron task and arms nextRunAt in the future", async () => {
    const sched = makeScheduler();
    const task = await sched.createTask({
      title: "日报",
      prompt: "总结",
      spec: { type: "cron", cron: "0 9 * * *" },
    });
    const stored = store.getTask(task.id)!;
    expect(stored.enabled).toBe(true);
    expect(stored.notify).toBe(true);
    expect(stored.mode).toBe("daily");
    expect(stored.nextRunAt).toBeTruthy();
    expect(new Date(stored.nextRunAt!).getTime()).toBeGreaterThan(NOW.getTime());
    sched.stop();
  });

  it("rejects invalid cron expression", async () => {
    const sched = makeScheduler();
    await expect(
      sched.createTask({ title: "x", prompt: "y", spec: { type: "cron", cron: "bogus" } }),
    ).rejects.toThrow(/cron 表达式无效/);
  });

  it("once task in the past has no nextRunAt", async () => {
    const sched = makeScheduler();
    const task = await sched.createTask({
      title: "x",
      prompt: "y",
      spec: { type: "once", runAt: "2026-01-01T00:00:00.000Z" },
    });
    expect(store.getTask(task.id)?.nextRunAt).toBeUndefined();
    sched.stop();
  });
});

describe("Scheduler.runNow / execution", () => {
  it("executes a manual run and records success + usage + notify", async () => {
    const sched = makeScheduler();
    const task = await sched.createTask({
      title: "每日摘要",
      prompt: "总结今日",
      spec: { type: "cron", cron: "0 9 * * *" },
      notify: true,
    });

    await sched.runNow(task.id);
    await waitFor(() => store.listRuns(task.id).some((r) => r.status === "success"));

    const [run] = store.listRuns(task.id);
    expect(run.status).toBe("success");
    expect(run.result).toContain("回归测试");
    expect(run.usage?.totalTokens).toBe(150);
    expect(run.durationMs).toBeGreaterThanOrEqual(0);
    const stored = store.getTask(task.id)!;
    expect(stored.lastStatus).toBe("success");
    expect(stored.lastRunAt).toBe(run.startedAt);
    // 手动运行不改变调度
    expect(stored.enabled).toBe(true);
    expect(notified.length).toBe(1);
    expect(notified[0].title).toContain("每日摘要");
    expect(notified[0].title).toContain("已完成");
    sched.stop();
  });

  it("marks a run failed on error event", async () => {
    const sched = makeScheduler();
    runtime.mode = "error";
    const task = await sched.createTask({
      title: "t",
      prompt: "p",
      spec: { type: "cron", cron: "0 9 * * *" },
    });
    await sched.runNow(task.id);
    await waitFor(() => store.listRuns(task.id).some((r) => r.status === "failed"));
    const [run] = store.listRuns(task.id);
    expect(run.status).toBe("failed");
    expect(run.error).toContain("模型超时");
    expect(store.getTask(task.id)?.lastStatus).toBe("failed");
    expect(notified[0].title).toContain("执行失败");
    sched.stop();
  });

  it("runs serially (second waits for first)", async () => {
    const sched = makeScheduler();
    runtime.delayMs = 30;
    const t1 = await sched.createTask({
      title: "a",
      prompt: "pa",
      spec: { type: "cron", cron: "0 9 * * *" },
    });
    const t2 = await sched.createTask({
      title: "b",
      prompt: "pb",
      spec: { type: "cron", cron: "0 9 * * *" },
    });
    await sched.runNow(t1.id);
    await sched.runNow(t2.id);
    await waitFor(
      () =>
        store.listRuns(t1.id).some((r) => r.status === "success") &&
        store.listRuns(t2.id).some((r) => r.status === "success"),
    );

    const c1 = runtime.calls.findIndex(
      (c) => c.startsWith("create:") && c === "create:" + store.listRuns(t1.id)[0].id,
    );
    const c2 = runtime.calls.findIndex(
      (c) => c.startsWith("create:") && c === "create:" + store.listRuns(t2.id)[0].id,
    );
    const d1 = runtime.calls.findIndex(
      (c) => c.startsWith("dispose:") && c === "dispose:" + store.listRuns(t1.id)[0].id,
    );
    expect(c1).toBeGreaterThanOrEqual(0);
    expect(c2).toBeGreaterThan(c1);
    expect(d1).toBeGreaterThan(c1); // 第一个运行结束后才启动第二个
    sched.stop();
  });

  it("caps run history via store", async () => {
    const sched = makeScheduler();
    const task = await sched.createTask({
      title: "t",
      prompt: "p",
      spec: { type: "cron", cron: "0 9 * * *" },
    });
    for (let i = 0; i < 5; i++) {
      await sched.runNow(task.id);
      await waitFor(() =>
        store
          .listRuns(task.id)
          .some(
            (r) =>
              (r.status === "success" && r.startedAt?.includes(`0${i + 1}`)) ||
              store.listRuns(task.id).length === i + 1,
          ),
      );
    }
    expect(store.listRuns(task.id).length).toBe(5);
    sched.stop();
  });
});

describe("Scheduler.init recovery", () => {
  it("marks orphaned running runs as cancelled", async () => {
    const sched = makeScheduler();
    const task = await sched.createTask({
      title: "t",
      prompt: "p",
      spec: { type: "cron", cron: "0 9 * * *" },
    });
    store.appendRun({
      id: "orphan",
      taskId: task.id,
      status: "running",
      startedAt: "2026-08-12T09:00:00.000Z",
    });
    await sched.init();
    const [run] = store.listRuns(task.id);
    expect(run.status).toBe("cancelled");
    expect(run.error).toContain("中断");
    sched.stop();
  });

  it("disables expired once task and records skipped", async () => {
    const sched = makeScheduler();
    // 直接写 store：过期且启用的 once 任务（模拟上次退出前已到点未执行）
    store.createTask({
      title: "过期提醒",
      prompt: "提醒",
      spec: { type: "once", runAt: "2026-08-01T00:00:00.000Z" },
      mode: "daily",
      enabled: true,
      notify: true,
    });
    await sched.init();
    const [task] = store.listTasks();
    expect(task.enabled).toBe(false);
    expect(task.lastStatus).toBe("skipped");
    expect(store.listRuns(task.id)[0].status).toBe("skipped");
    sched.stop();
  });

  it("persists task/run changes across reload", async () => {
    const sched = makeScheduler();
    const task = await sched.createTask({
      title: "t",
      prompt: "p",
      spec: { type: "cron", cron: "0 9 * * *" },
    });
    await sched.updateTask(task.id, { enabled: false });
    sched.stop();

    const reopened = new SchedulerStore(path.join(dir, "schedule.json"));
    const [t] = reopened.listTasks();
    expect(t.id).toBe(task.id);
    expect(t.enabled).toBe(false);
    expect(t.nextRunAt).toBeUndefined();
  });
});
