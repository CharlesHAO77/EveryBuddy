import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ScheduledRun, ScheduledTask } from "@everybuddy/ipc-contract";
import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RUNS_PER_TASK, SchedulerStore } from "../src/main/schedulerStore";

let dir: string;
let store: SchedulerStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "eb-sched-store-"));
  store = new SchedulerStore(path.join(dir, "schedule.json"));
});

function makeTask(
  over: Partial<ScheduledTask> = {},
): Omit<ScheduledTask, "id" | "createdAt" | "updatedAt"> {
  return {
    title: "日报",
    prompt: "总结今日工作",
    spec: { type: "cron", cron: "0 9 * * *" },
    mode: "daily",
    enabled: true,
    notify: true,
    ...over,
  };
}

function makeRun(taskId: string, startedAt: string): ScheduledRun {
  return { id: `r-${startedAt}`, taskId, status: "success", startedAt, finishedAt: startedAt };
}

describe("SchedulerStore CRUD", () => {
  it("creates task with id + timestamps", () => {
    const task = store.createTask(makeTask());
    expect(task.id).toBeTruthy();
    expect(task.createdAt).toBeTruthy();
    expect(store.getTask(task.id)?.title).toBe("日报");
    expect(store.listTasks()).toHaveLength(1);
  });

  it("updates task fields without clobbering id", () => {
    const task = store.createTask(makeTask());
    const updated = store.updateTask(task.id, { enabled: false, prompt: "新提示词" });
    expect(updated?.enabled).toBe(false);
    expect(updated?.prompt).toBe("新提示词");
    expect(updated?.id).toBe(task.id);
    expect(updated?.spec).toEqual(task.spec);
    expect(updated?.createdAt).toBe(task.createdAt);
  });

  it("updateTask returns undefined for missing id", () => {
    expect(store.updateTask("nope", { enabled: false })).toBeUndefined();
  });

  it("removes task", () => {
    const task = store.createTask(makeTask());
    store.removeTask(task.id);
    expect(store.getTask(task.id)).toBeUndefined();
  });

  it("survives corrupt file with default shape", () => {
    store = new SchedulerStore(path.join(dir, "corrupt.json"));
    store.createTask(makeTask());
    // 覆盖为非法 JSON 后重建 store，读回应为默认空
    writeFileSync(path.join(dir, "corrupt.json"), "{oops", "utf-8");
    const reopened = new SchedulerStore(path.join(dir, "corrupt.json"));
    expect(reopened.listTasks()).toEqual([]);
  });
});

describe("SchedulerStore runs", () => {
  it("lists runs newest first", () => {
    store.appendRun(makeRun("t1", "2026-08-13T01:00:00.000Z"));
    store.appendRun(makeRun("t1", "2026-08-13T03:00:00.000Z"));
    store.appendRun(makeRun("t1", "2026-08-13T02:00:00.000Z"));
    const runs = store.listRuns("t1");
    expect(runs.map((r) => r.id)).toEqual([
      "r-2026-08-13T03:00:00.000Z",
      "r-2026-08-13T02:00:00.000Z",
      "r-2026-08-13T01:00:00.000Z",
    ]);
  });

  it("caps runs per task at MAX_RUNS_PER_TASK keeping newest", () => {
    for (let i = 0; i < MAX_RUNS_PER_TASK + 10; i++) {
      store.appendRun(makeRun("t1", `2026-08-01T00:${String(i % 60).padStart(2, "0")}:00.000Z`));
    }
    expect(store.listRuns("t1")).toHaveLength(MAX_RUNS_PER_TASK);
    // 保留的是最新的（序号大的）
    const ids = store.listRuns("t1").map((r) => r.id);
    expect(ids).toContain(
      `r-2026-08-01T00:${String((MAX_RUNS_PER_TASK + 9) % 60).padStart(2, "0")}:00.000Z`,
    );
  });

  it("removes runs for a task", () => {
    store.appendRun(makeRun("t1", "2026-08-13T01:00:00.000Z"));
    store.appendRun(makeRun("t2", "2026-08-13T01:00:00.000Z"));
    store.removeRunsForTask("t1");
    expect(store.listRuns("t1")).toHaveLength(0);
    expect(store.listRuns("t2")).toHaveLength(1);
  });

  it("updateRun applies patch and preserves id", () => {
    const run = makeRun("t1", "2026-08-13T01:00:00.000Z");
    store.appendRun(run);
    store.updateRun(run.id, { status: "cancelled", error: "中断" });
    const [updated] = store.listRuns("t1");
    expect(updated.status).toBe("cancelled");
    expect(updated.error).toBe("中断");
    expect(updated.id).toBe(run.id);
  });
});
