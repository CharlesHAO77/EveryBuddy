/**
 * teamRunStore 单元测试：子 agent / workflow 过程记录读写、去重、删除、序列化往返。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SubAgentRunRecord, WorkflowRunRecord } from "@everybuddy/ipc-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TeamRunStore } from "../src/main/teamRunStore";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "eb-team-runs-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeSub(id: string, opts: Partial<SubAgentRunRecord> = {}): SubAgentRunRecord {
  return {
    subagentId: id,
    parentToolCallId: "tool-1",
    expertId: "daily",
    expertName: "办公助理",
    prompt: "做件事",
    status: "ok",
    text: `输出-${id}`,
    tools: [{ toolName: "read", toolCallId: "c1", phase: "end", output: "file" }],
    startedAt: 1000,
    endedAt: 2000,
    ...opts,
  };
}

function makeWorkflow(opts: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    runId: "task1",
    workflowId: "wf-1",
    name: "软件研发",
    status: "ok",
    steps: [
      {
        stepId: "analysis",
        expertIds: ["daily"],
        kind: "serial",
        status: "ok",
        output: "需求要点",
        subagents: [makeSub("s-analysis")],
      },
    ],
    summary: "汇总",
    startedAt: 1000,
    finishedAt: 3000,
    ...opts,
  };
}

describe("TeamRunStore", () => {
  it("recordSubagent 写入并按 subagentId 去重升位；get 返回", () => {
    const store = new TeamRunStore(path.join(dir, "team-runs.json"));
    expect(store.get("task1")).toBeUndefined();
    store.recordSubagent("task1", makeSub("a"));
    store.recordSubagent("task1", makeSub("b"));
    store.recordSubagent("task1", makeSub("a", { text: "更新后" })); // 同 id 升位
    const rec = store.get("task1");
    expect(rec?.subAgents).toHaveLength(2);
    expect(rec?.subAgents.find((s) => s.subagentId === "a")?.text).toBe("更新后");
    expect(rec?.taskId).toBe("task1");
  });

  it("recordWorkflow 覆盖最近一次运行并保留 subAgents", () => {
    const store = new TeamRunStore(path.join(dir, "team-runs.json"));
    store.recordSubagent("task1", makeSub("a"));
    store.recordWorkflow("task1", makeWorkflow());
    let rec = store.get("task1");
    expect(rec?.workflowRun?.name).toBe("软件研发");
    expect(rec?.subAgents).toHaveLength(1); // workflow 写入不清空 subAgents
    store.recordWorkflow("task1", makeWorkflow({ name: "第二次运行" }));
    rec = store.get("task1");
    expect(rec?.workflowRun?.name).toBe("第二次运行");
    expect(rec?.workflowRun?.steps).toHaveLength(1);
  });

  it("remove 删除某任务记录", () => {
    const store = new TeamRunStore(path.join(dir, "team-runs.json"));
    store.recordSubagent("task1", makeSub("a"));
    store.recordSubagent("task2", makeSub("b"));
    store.remove("task1");
    expect(store.get("task1")).toBeUndefined();
    expect(store.get("task2")?.subAgents).toHaveLength(1);
  });

  it("序列化往返：新实例 load 后记录完整（模拟重开应用追溯）", () => {
    const file = path.join(dir, "team-runs.json");
    const store1 = new TeamRunStore(file);
    store1.recordSubagent("task1", makeSub("a"));
    store1.recordWorkflow("task1", makeWorkflow());
    // 新实例从同一文件读回
    const store2 = new TeamRunStore(file);
    const rec = store2.get("task1");
    expect(rec?.subAgents[0]).toMatchObject({ subagentId: "a", text: "输出-a" });
    expect(rec?.workflowRun?.steps[0]?.subagents[0]?.subagentId).toBe("s-analysis");
    expect(rec?.workflowRun?.status).toBe("ok");
  });
});
