/**
 * teamRuntime 单元测试：子 Agent 引擎（runSubagent）+ workflow 编排（runWorkflow）。
 *
 * 用 fake 会话工厂 + fake deps（不落盘、不打 SDK），断言事件时序 / 文本 / usage /
 * 中止级联 / 模板替换 / 默认 workflow 生成。
 */

import type { Expert, ExpertTeam, TaskMeta, WorkflowStep } from "@everybuddy/ipc-contract";
import { describe, expect, it } from "vitest";
import type { CodingAgentSDK } from "../src/main/sessionBuilder";
import { TeamRuntime, type TeamRuntimeDeps } from "../src/main/teamRuntime";
import type { ToolAvailability } from "../src/main/tools/toolAvailability";

type PlainEvent = { type: string; [k: string]: unknown };
type CollectedEvent = { type: string; payload?: unknown };

/** fake 子会话：按 script 发合成 SDK 事件；可配置挂起（等 abort）或抛错 */
class FakeChildSession {
  aborted = false;
  hang = false;
  throwOnPrompt = false;
  lastPrompt = "";
  private cb: ((e: PlainEvent) => void) | null = null;

  constructor(private script: PlainEvent[] = []) {}

  subscribe(cb: (e: unknown) => void): () => void {
    this.cb = cb as (e: PlainEvent) => void;
    return () => {
      this.cb = null;
    };
  }

  async prompt(text: string): Promise<void> {
    this.lastPrompt = text;
    if (this.throwOnPrompt) throw new Error("子会话爆炸");
    if (this.hang) {
      await new Promise<void>((resolve) => {
        const tick = () => (this.aborted ? resolve() : setTimeout(tick, 5));
        tick();
      });
      return;
    }
    for (const e of this.script) this.cb?.(e);
  }

  async abort(): Promise<void> {
    this.aborted = true;
  }

  dispose(): void {}
}

function makeScript(output: string, usageInput = 10, usageOutput = 5): PlainEvent[] {
  return [
    { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: output } },
    {
      type: "message_update",
      assistantMessageEvent: { type: "text_end", content: output },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        usage: {
          input: usageInput,
          output: usageOutput,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: usageInput + usageOutput,
        },
      },
    },
  ];
}

function makeDeps(overrides: Partial<TeamRuntimeDeps> = {}): {
  deps: TeamRuntimeDeps;
  events: CollectedEvent[];
} {
  const events: CollectedEvent[] = [];
  const deps: TeamRuntimeDeps = {
    emitTo: (_sid, evt) => events.push(evt as CollectedEvent),
    loadSdk: async () => ({}) as unknown as CodingAgentSDK,
    ensureModelRuntime: async () => {},
    getModelRuntime: () => null,
    getAvailability: () => ({}) as unknown as ToolAvailability,
    resolveModel: () => undefined,
    getTaskCwd: () => "/tmp",
    getTask: () => undefined,
    getTeam: () => undefined,
    findExpert: () => undefined,
    ...overrides,
  };
  return { deps, events };
}

function makeRuntime(overrides: Partial<TeamRuntimeDeps> = {}) {
  const { deps, events } = makeDeps(overrides);
  const runtime = new TeamRuntime();
  runtime.wire(deps);
  return { runtime, events, deps };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("TeamRuntime.runSubagent", () => {
  it("流式 subagent_start/delta/end 并返回最终文本 + usage", async () => {
    const { runtime, events } = makeRuntime();
    runtime.setSessionFactory(async () => ({
      session: new FakeChildSession(makeScript("你好，世界")) as never,
      dispose: () => {},
    }));

    const res = await runtime.runSubagent({
      parentTaskId: "t1",
      parentToolCallId: "tool1",
      expertId: "coding",
      prompt: "做件事",
      cwd: "/tmp",
    });

    expect(res.status).toBe("ok");
    expect(res.text).toBe("你好，世界");
    expect(res.usage?.totalTokens).toBe(15);

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("subagent_start");
    expect(types).toContain("subagent_delta");
    const start = events.find((e) => e.type === "subagent_start");
    expect(start?.payload).toMatchObject({ parentToolCallId: "tool1", expertId: "coding" });
    const end = events.find((e) => e.type === "subagent_end");
    expect(end?.payload).toMatchObject({ status: "ok", text: "你好，世界" });
  });

  it("父 signal abort 级联中止子会话，状态 aborted", async () => {
    const { runtime } = makeRuntime();
    const controller = new AbortController();
    const session = new FakeChildSession([]);
    session.hang = true;
    runtime.setSessionFactory(async () => ({
      session: session as never,
      dispose: () => {},
    }));

    const p = runtime.runSubagent({
      parentTaskId: "t1",
      parentToolCallId: "tool1",
      expertId: "coding",
      prompt: "x",
      cwd: "/tmp",
      signal: controller.signal,
    });
    // 等子会话创建 + 信号监听挂上（hang 的 prompt 已进入等待）
    await sleep(20);
    controller.abort();
    const res = await p;

    expect(res.status).toBe("aborted");
    expect(session.aborted).toBe(true);
  });

  it("子会话抛错 → status error 且不向外抛（父 turn 继续）", async () => {
    const { runtime } = makeRuntime();
    const session = new FakeChildSession([]);
    session.throwOnPrompt = true;
    runtime.setSessionFactory(async () => ({
      session: session as never,
      dispose: () => {},
    }));

    const res = await runtime.runSubagent({
      parentTaskId: "t1",
      parentToolCallId: "tool1",
      expertId: "coding",
      prompt: "x",
      cwd: "/tmp",
    });

    expect(res.status).toBe("error");
    expect(res.error).toContain("子会话爆炸");
  });

  it("并发上限：超过 MAX_CONCURRENT 的调用排队", async () => {
    const { runtime } = makeRuntime();
    const sessions: FakeChildSession[] = [];
    runtime.setSessionFactory(async () => {
      const s = new FakeChildSession([]);
      s.hang = true;
      sessions.push(s);
      return { session: s as never, dispose: () => {} };
    });

    const make = () =>
      runtime.runSubagent({
        parentTaskId: "t",
        parentToolCallId: `t${sessions.length}`,
        expertId: "e",
        prompt: "x",
        cwd: "/tmp",
      });
    const p1 = make();
    const p2 = make();
    const p3 = make();
    const p4 = make();
    await sleep(20);
    expect(sessions.length).toBe(4); // 4 个已创建并挂起
    const p5 = make();
    await sleep(20);
    expect(sessions.length).toBe(4); // 第 5 个仍在排队（未创建）
    // 放行前 4 个（abort → hang 的 prompt resolve → 释放信号量 → 第 5 个创建执行）
    for (const s of sessions) s.aborted = true;
    await sleep(20);
    expect(sessions.length).toBe(5);
    if (sessions[4]) sessions[4].aborted = true; // 放行第 5 个
    await Promise.allSettled([p1, p2, p3, p4, p5]);
  });
});

describe("TeamRuntime workflow", () => {
  const team: ExpertTeam = {
    id: "team-test",
    name: "测试团",
    icon: "users",
    description: "",
    expertIds: ["e1", "e2", "e3"],
    tags: [],
    routingStrategy: "workflow",
    source: "custom",
    workflow: {
      id: "wf-test",
      name: "测试流程",
      steps: [
        { kind: "serial", id: "s1", expertId: "e1", prompt: "分析：{user}" },
        { kind: "serial", id: "s2", expertId: "e2", prompt: "基于 {{s1.result}} 执行" },
      ],
      summarizerExpertId: "e3",
    },
    createdAt: "",
    updatedAt: "",
  };
  const experts: Record<string, Expert> = {
    e1: {
      id: "e1",
      name: "分析师",
      icon: "clipboard",
      description: "",
      mode: "daily",
      tags: [],
      source: "custom",
      createdAt: "",
      updatedAt: "",
    },
    e2: {
      id: "e2",
      name: "执行",
      icon: "code",
      description: "",
      mode: "coding",
      tags: [],
      source: "custom",
      createdAt: "",
      updatedAt: "",
    },
    e3: {
      id: "e3",
      name: "评审",
      icon: "monitor",
      description: "",
      mode: "daily",
      tags: [],
      source: "custom",
      createdAt: "",
      updatedAt: "",
    },
  };
  const task: TaskMeta = {
    id: "task1",
    title: "任务",
    type: "temp",
    mode: "daily",
    sessionDir: "/tmp",
    createdAt: "",
    updatedAt: "",
  };

  function makeWfRuntime() {
    const sessions: FakeChildSession[] = [];
    const { runtime, events } = makeRuntime({
      getTask: () => task,
      getTeam: () => team,
      findExpert: (id) => experts[id],
    });
    runtime.setSessionFactory(async () => {
      const s = new FakeChildSession(makeScript(`产出-${sessions.length + 1}`));
      sessions.push(s);
      return { session: s as never, dispose: () => {} };
    });
    return { runtime, events, sessions };
  }

  /** 自定义团队 + 自定义子代理输出脚本（按创建序取，缺省「产出-N」） */
  function makeWfRuntimeWith(teamOverride: ExpertTeam, scripts: string[] = []) {
    const sessions: FakeChildSession[] = [];
    const { runtime, events } = makeRuntime({
      getTask: () => task,
      getTeam: () => teamOverride,
      findExpert: (id) => experts[id],
    });
    runtime.setSessionFactory(async () => {
      const out = scripts[sessions.length] ?? `产出-${sessions.length + 1}`;
      const s = new FakeChildSession(makeScript(out));
      sessions.push(s);
      return { session: s as never, dispose: () => {} };
    });
    return { runtime, events, sessions };
  }

  const condStep = (): WorkflowStep => ({
    kind: "conditional",
    id: "gate",
    logic: "and",
    rules: [{ var: "s1", op: "contains", value: "通过" }],
    thenSteps: [{ kind: "serial", id: "pub", expertId: "e2", prompt: "基于 {{s1.result}} 发布" }],
    elseSteps: [{ kind: "serial", id: "fix", expertId: "e3", prompt: "基于 {{s1.result}} 修复" }],
  });

  it("串行执行步骤 + 模板替换 + 事件时序 + 汇总", async () => {
    const { runtime, events, sessions } = makeWfRuntime();
    await runtime.runWorkflow("task1", "team-test", "写一个工具", "prov");

    // 步骤提示词模板替换
    expect(sessions[0]?.lastPrompt).toContain("分析：写一个工具");
    expect(sessions[1]?.lastPrompt).toContain("基于 产出-1 执行");
    expect(sessions[2]?.lastPrompt).toContain("综合以下各步产出"); // 汇总步骤

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("workflow_start");
    expect(types).toContain("workflow_step_start");
    expect(types).toContain("workflow_step_end");
    // s1 的 step_end 先于 s2 的 step_start（串行）
    const s1End = events.findIndex(
      (e) => e.type === "workflow_step_end" && (e.payload as { stepId?: string })?.stepId === "s1",
    );
    const s2Start = events.findIndex(
      (e) =>
        e.type === "workflow_step_start" && (e.payload as { stepId?: string })?.stepId === "s2",
    );
    expect(s1End).toBeGreaterThan(-1);
    expect(s2Start).toBeGreaterThan(s1End);

    const wfEnd = events.find((e) => e.type === "workflow_end");
    expect(wfEnd?.payload).toMatchObject({ status: "ok" });
    expect((wfEnd?.payload as { summary?: string })?.summary).toContain("产出-3");
  });

  it("buildDefaultWorkflow 按成员序生成步骤 + 末位汇总", () => {
    const { runtime } = makeRuntime();
    const wf = runtime.buildDefaultWorkflow(team, Object.values(experts));
    expect(wf.steps.length).toBe(2);
    expect(wf.summarizerExpertId).toBe("e3");
    expect(wf.steps[0]).toMatchObject({ kind: "serial", expertId: "e1" });
    expect(wf.steps[1]).toMatchObject({ kind: "serial", expertId: "e2" });
  });

  it("buildCoordinatorInstructions 内嵌成员名册（含角色）", () => {
    const { runtime } = makeRuntime();
    const teamWithRoles: ExpertTeam = { ...team, roles: { e1: "分析师", e2: "编码" } };
    const instructions = runtime.buildCoordinatorInstructions(
      teamWithRoles,
      Object.values(experts),
    );
    const joined = instructions.join("\n");
    expect(joined).toContain("分析师");
    expect(joined).toContain("【分析师】");
    expect(joined).toContain("delegate");
  });

  it("coordinatorExpertId 返回主 agent（leadExpertId ?? 首成员）", () => {
    const { runtime } = makeRuntime();
    expect(runtime.coordinatorExpertId({ ...team, leadExpertId: "e3" })).toBe("e3");
    expect(runtime.coordinatorExpertId(team)).toBe("e1");
  });

  it("条件为真 → 走 then 子链，事件带 pass=true，模板替换正确", async () => {
    const teamCond: ExpertTeam = {
      ...team,
      id: "team-cond",
      workflow: {
        id: "wf-cond",
        name: "条件流程",
        steps: [{ kind: "serial", id: "s1", expertId: "e1", prompt: "分析：{user}" }, condStep()],
        summarizerExpertId: "e1",
      },
    };
    // s1 输出「评审通过」→ 规则命中 → 走 then（pub），不走 else（fix）
    const { runtime, events, sessions } = makeWfRuntimeWith(teamCond, ["评审通过", "发布结果"]);
    await runtime.runWorkflow("task1", "team-cond", "写个工具", "prov");

    expect(sessions[1]?.lastPrompt).toContain("基于 评审通过 发布");
    expect(sessions.some((s) => s.lastPrompt.includes("修复"))).toBe(false);
    const gateStart = events.find(
      (e) =>
        e.type === "workflow_step_start" && (e.payload as { stepId?: string })?.stepId === "gate",
    );
    expect(gateStart?.payload).toMatchObject({ kind: "conditional", pass: true });
    const gateEnd = events.find(
      (e) =>
        e.type === "workflow_step_end" && (e.payload as { stepId?: string })?.stepId === "gate",
    );
    expect(gateEnd?.payload).toMatchObject({ pass: true });
  });

  it("条件为假 → 走 else 子链，step_start 带 pass=false", async () => {
    const teamCond: ExpertTeam = {
      ...team,
      id: "team-cond2",
      workflow: {
        id: "wf-cond2",
        name: "条件流程2",
        steps: [{ kind: "serial", id: "s1", expertId: "e1", prompt: "分析" }, condStep()],
        summarizerExpertId: "e1",
      },
    };
    // s1 输出「评审失败」→ 未命中 → 走 else（fix）
    const { runtime, sessions } = makeWfRuntimeWith(teamCond, ["评审失败", "修复结果"]);
    await runtime.runWorkflow("task1", "team-cond2", "写个工具", "prov");

    expect(sessions[1]?.lastPrompt).toContain("基于 评审失败 修复");
    expect(sessions.some((s) => s.lastPrompt.includes("发布"))).toBe(false);
  });

  it("条件分支为空 → 无操作继续（gate 不产生子代理）", async () => {
    const teamEmpty: ExpertTeam = {
      ...team,
      id: "team-empty",
      expertIds: [], // 无汇总步骤
      workflow: {
        id: "wf-empty",
        name: "空分支",
        steps: [
          { kind: "serial", id: "s1", expertId: "e1", prompt: "分析" },
          { kind: "conditional", id: "gate", logic: "and", rules: [], thenSteps: [] },
        ],
      },
    };
    const { runtime, events, sessions } = makeWfRuntimeWith(teamEmpty, ["产出-A"]);
    await runtime.runWorkflow("task1", "team-empty", "hi", "prov");

    expect(sessions.length).toBe(1); // 只有 s1，gate 空分支不建子代理
    const gateEnd = events.find(
      (e) =>
        e.type === "workflow_step_end" && (e.payload as { stepId?: string })?.stepId === "gate",
    );
    expect(gateEnd?.payload).toMatchObject({ ok: true, pass: true }); // 空规则恒真
  });

  it("嵌套条件：then 分支内再条件，递归执行", async () => {
    const teamNest: ExpertTeam = {
      ...team,
      id: "team-nest",
      workflow: {
        id: "wf-nest",
        name: "嵌套",
        steps: [
          { kind: "serial", id: "s1", expertId: "e1", prompt: "分析" },
          {
            kind: "conditional",
            id: "gate1",
            logic: "and",
            rules: [{ var: "s1", op: "contains", value: "通过" }],
            thenSteps: [
              {
                kind: "conditional",
                id: "gate2",
                logic: "and",
                rules: [{ var: "s1", op: "contains", value: "OK" }],
                thenSteps: [
                  { kind: "serial", id: "inner", expertId: "e2", prompt: "内层：{{s1.result}}" },
                ],
                elseSteps: [],
              },
            ],
            elseSteps: [{ kind: "serial", id: "fix", expertId: "e3", prompt: "修复" }],
          },
        ],
        summarizerExpertId: "e1",
      },
    };
    // s1 输出「通过OK」→ gate1 then → gate2 then → inner 执行
    const { runtime, sessions } = makeWfRuntimeWith(teamNest, ["通过OK", "内层结果"]);
    await runtime.runWorkflow("task1", "team-nest", "hi", "prov");

    expect(sessions[1]?.lastPrompt).toContain("内层：通过OK");
    expect(sessions.some((s) => s.lastPrompt.includes("修复"))).toBe(false);
  });

  it("并行步骤：并发子代理 + 结果拼接 + {{group.result}} 替换", async () => {
    const teamPara: ExpertTeam = {
      ...team,
      id: "team-para",
      workflow: {
        id: "wf-para",
        name: "并行",
        steps: [
          { kind: "serial", id: "s1", expertId: "e1", prompt: "分析" },
          {
            kind: "parallel",
            id: "p1",
            steps: [
              { id: "pa", expertId: "e2", prompt: "做A基于 {{s1.result}}" },
              { id: "pb", expertId: "e3", prompt: "做B基于 {{s1.result}}" },
            ],
          },
          { kind: "serial", id: "s2", expertId: "e1", prompt: "汇总 {{p1.result}}" },
        ],
        summarizerExpertId: "e1",
      },
    };
    const { runtime, events, sessions } = makeWfRuntimeWith(teamPara, [
      "第一步",
      "A输出",
      "B输出",
      "汇总之作",
    ]);
    await runtime.runWorkflow("task1", "team-para", "hi", "prov");

    // p1 两成员并发，模板各拿到 s1 输出
    expect(sessions[1]?.lastPrompt).toContain("基于 第一步");
    expect(sessions[2]?.lastPrompt).toContain("基于 第一步");
    // s2 收到 p1 拼接结果（A输出\n\nB输出）
    expect(sessions[3]?.lastPrompt).toContain("A输出\n\nB输出");
    const p1Start = events.find(
      (e) =>
        e.type === "workflow_step_start" && (e.payload as { stepId?: string })?.stepId === "p1",
    );
    expect(p1Start?.payload).toMatchObject({ kind: "parallel", expertIds: ["e2", "e3"] });
    // 两个 p1 子代理 end 先于 s2 的 start（组内并发、整体等待）
    const paEnd = events.findIndex(
      (e) => e.type === "subagent_end" && (e.payload as { stepId?: string })?.stepId === "p1",
    );
    const s2Start = events.findIndex(
      (e) =>
        e.type === "workflow_step_start" && (e.payload as { stepId?: string })?.stepId === "s2",
    );
    expect(paEnd).toBeGreaterThan(-1);
    expect(s2Start).toBeGreaterThan(paEnd);
  });

  it("并行组成员并发启动（hang 证明并发）", async () => {
    const teamHang: ExpertTeam = {
      ...team,
      id: "team-hang",
      expertIds: [], // 无汇总步骤
      workflow: {
        id: "wf-hang",
        name: "并发",
        steps: [
          {
            kind: "parallel",
            id: "p1",
            steps: [
              { id: "pa", expertId: "e2", prompt: "A" },
              { id: "pb", expertId: "e3", prompt: "B" },
            ],
          },
        ],
      },
    };
    const sessions: FakeChildSession[] = [];
    const { runtime, events } = makeRuntime({
      getTask: () => task,
      getTeam: () => teamHang,
      findExpert: (id) => experts[id],
    });
    runtime.setSessionFactory(async () => {
      const s = new FakeChildSession([]);
      s.hang = true; // 挂起，证明两个 runSubagent 同时进入
      sessions.push(s);
      return { session: s as never, dispose: () => {} };
    });

    const run = runtime.runWorkflow("task1", "team-hang", "hi", "prov");
    await sleep(20);
    expect(sessions.length).toBe(2); // 两个成员都已创建（并发），未完成
    runtime.abortForTask("task1"); // 级联中止 → 两个挂起子会话经 abortChild 放行
    await run;
    const p1End = events.find(
      (e) => e.type === "workflow_step_end" && (e.payload as { stepId?: string })?.stepId === "p1",
    );
    expect(p1End?.payload).toMatchObject({ ok: false }); // 两个子代理均 aborted → 步骤 error
  });
});
