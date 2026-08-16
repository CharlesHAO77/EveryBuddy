/**
 * teamRuntime - 专家团运行时（子 Agent 引擎 + Workflow 编排）。
 *
 * 两条能力线（routingStrategy）：
 *  - auto（subagent-as-tools）：coordinator 主会话获得 delegate 工具；被委派时在本进程
 *    创建一个隔离的子 AgentSession（headless、SessionManager.inMemory），用成员专家的人格
 *    /模型/工具执行子任务，流式 subagent_* 事件到父任务，结果作为 delegate 工具输出返回。
 *  - workflow：代码定义的确定性流水线，每步经 runSubagent 执行，步骤间 {{stepId.result}}
 *    模板串联，workflow_* + subagent_* 事件驱动渲染层运行卡。
 *
 * 依赖注入：与 scheduler 同款 DI——teamRuntime 不 value-import agentRuntime（避免依赖环），
 * 能力经 wire(deps) 注入（agentRuntime.getTeamDeps()），事件经 deps.emitTo 写入同一监听器集。
 */

import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  Expert,
  ExpertTeam,
  MessageUsage,
  SubAgentRunRecord,
  TaskMeta,
  TeamWorkflow,
  WorkflowRunRecord,
  WorkflowStep,
  WorkflowStepRecord,
} from "@everybuddy/ipc-contract";
import { addUsage } from "./scheduler";
import {
  buildSessionConfig,
  type CodingAgentSDK,
  type ModelRuntime,
  type PiModel,
  type SessionManagerInstance,
  type WithoutStreamId,
} from "./sessionBuilder";
import { teamRunStore } from "./teamRunStore";
import type { ToolAvailability } from "./tools/toolAvailability";
import { evalWorkflowCondition } from "./workflowCondition";

// ────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────

type AgentSession = CodingAgentSDK["AgentSession"] extends new (
  ...args: never[]
) => infer T
  ? T
  : never;

/** 子代理运行结果（delegate 工具输出 / workflow 步骤聚合） */
export interface SubagentResult {
  subagentId: string;
  text: string;
  usage?: MessageUsage;
  status: "ok" | "error" | "aborted";
  error?: string;
  /** 持久化的执行过程记录（供 workflow 步骤组装与追溯） */
  record?: SubAgentRunRecord;
}

/** agentRuntime 注入给 TeamRuntime 的依赖（见 getTeamDeps） */
export interface TeamRuntimeDeps {
  /** 向指定 streamId 推送归一化事件（写入 agentRuntime 同一监听器集，广播到渲染进程） */
  emitTo: (streamId: string, evt: WithoutStreamId<AgentEvent>) => void;
  loadSdk: () => Promise<CodingAgentSDK>;
  ensureModelRuntime: () => Promise<void>;
  getModelRuntime: () => ModelRuntime | null;
  getAvailability: () => ToolAvailability;
  resolveModel: (providerId: string) => PiModel | undefined;
  getTaskCwd: (taskId: string) => string;
  getTask: (taskId: string) => TaskMeta | undefined;
  /** 团队解析（agentRuntime 提供 teamStore.get；测试可注入 fake，避免落盘） */
  getTeam: (id: string) => ExpertTeam | undefined;
  /** 专家解析（agentRuntime 提供 findExpert；测试可注入 fake） */
  findExpert: (id: string) => Expert | undefined;
}

/** 子会话工厂：创建隔离的子 AgentSession（headless），runSubagent 自行订阅事件 */
export type SubagentSessionFactory = (opts: {
  expertId: string;
  cwd: string;
  providerId?: string;
  parentTaskId: string;
}) => Promise<{ session: AgentSession; dispose: () => void }>;

interface ActiveSubagent {
  subagentId: string;
  session: AgentSession;
  dispose: () => void;
  parentTaskId: string;
}

interface SubagentCtx {
  subagentId: string;
  parentTaskId: string;
  parentToolCallId: string;
  stepId?: string;
  onUpdate?: (partial: {
    content: Array<{ type: "text"; text: string }>;
    details: Record<string, unknown>;
  }) => void;
}

// ────────────────────────────────────────────────
// TeamRuntime
// ────────────────────────────────────────────────

/** 收集步骤涉及的全部专家 id（条件节点取两分支并集，供 step_start/record 展示） */
function collectStepExpertIds(step: WorkflowStep): string[] {
  if (step.kind === "serial") return [step.expertId];
  if (step.kind === "parallel") return step.steps.map((s) => s.expertId);
  return [...step.thenSteps, ...(step.elseSteps ?? [])].flatMap(collectStepExpertIds);
}

export class TeamRuntime {
  private deps: TeamRuntimeDeps | null = null;
  /** 活跃子代理句柄：subagentId -> { session, dispose, parentTaskId } */
  private active = new Map<string, ActiveSubagent>();
  /** workflow 级中止信号：`wf:${taskId}` -> AbortController */
  private wfAborts = new Map<string, AbortController>();
  /** 全局并发信号量（delegate 并行 + workflow 步骤共用上限） */
  private running = 0;
  private waiters: Array<() => void> = [];

  private static readonly MAX_CONCURRENT = 4;
  private static readonly SUBAGENT_MAX_MS = 10 * 60 * 1000;

  /** 会话工厂（测试可注入 fake；生产 = realSubagentSessionFactory） */
  private sessionFactory: SubagentSessionFactory = (opts) => this.realSubagentSessionFactory(opts);

  wire(deps: TeamRuntimeDeps): void {
    this.deps = deps;
  }

  /** 测试注入 fake 会话工厂 */
  setSessionFactory(f: SubagentSessionFactory): void {
    this.sessionFactory = f;
  }

  // ── 提示词 / 工作流构建 ───────────────────

  /** 主 agent id（auto 团队协调者）：leadExpertId ?? 首成员 */
  coordinatorExpertId(team: ExpertTeam): string | undefined {
    return team.leadExpertId ?? team.expertIds[0];
  }

  /**
   * 生成协调者委派指令（auto 团队）：作为 appendSystemPrompt 追加到主 agent 人格之后，
   * 含团队目标 + 可委派成员名册（带角色）+ 委派工作方式。
   */
  buildCoordinatorInstructions(team: ExpertTeam, members: Expert[]): string[] {
    const roster = members
      .map((e) => {
        const role = team.roles?.[e.id];
        return `- ${e.name}（id: ${e.id}）${role ? `【${role}】` : ""}：${e.description}`;
      })
      .join("\n");
    return [
      `你是专家团「${team.name}」的协调者。${team.description ? `团队目标：${team.description}` : ""}`,
      `可委派的团队成员：\n${roster}`,
      "你的工作方式：",
      "1. 先分析用户需求，判断需要哪些成员协作；",
      "2. 用 delegate 工具把子任务分派给成员（同一回合可并行调用多个成员）；",
      "3. 等待并整合各成员结果，输出最终汇总；",
      "4. 若某成员结果不充分，可再次委派或直接补充。",
      "请用中文回复用户。",
    ];
  }

  /**
   * 代码生成默认 workflow（用户自建 workflow 团队未配 workflow 时回退）：
   * 成员序首=需求分析，中段=执行，末位=汇总评审（summarizer）。
   */
  buildDefaultWorkflow(team: ExpertTeam, members: Expert[]): TeamWorkflow {
    const ids = members.map((m) => m.id);
    const steps: WorkflowStep[] = [];
    if (ids.length > 1) {
      ids.slice(0, -1).forEach((id, i) => {
        const role =
          i === 0
            ? "需求分析师：针对「{user}」澄清需求并输出要点与验收标准"
            : "执行专家：基于上一步结果完成你的部分";
        const prev = i > 0 ? ` 上一步结果见 {{step-${i}.result}}。` : "";
        steps.push({
          kind: "serial",
          id: `step-${i + 1}`,
          expertId: id,
          prompt: `你是${role}。${prev}`,
        });
      });
    }
    return {
      id: `wf-default-${team.id}`,
      name: `${team.name} 默认流程`,
      description: "按成员顺序：分析 → 执行 → 评审汇总",
      steps,
      summarizerExpertId: ids[ids.length - 1],
    };
  }

  // ── delegate 工具（auto） ───────────────────

  /**
   * 构造 delegate 工具（auto 团队）：单个工具 + expert 枚举参数，description 内嵌成员名册
   * 让模型直接选 id。一次调用 = 一个子 agent；同一回合多次调用即并行 fan-out。
   */
  async buildDelegateTools(
    team: ExpertTeam,
    ctx: { parentTaskId: string; cwd: string },
  ): Promise<ToolDefinition[]> {
    if (team.routingStrategy !== "auto") return [];
    if (!this.deps) return [];
    const sdk = await this.deps.loadSdk();
    const { Type } = await import("typebox");
    // 委派名单 = 成员（不含主 agent/协调者，避免自委派）；带角色标注
    const coordinatorId = this.coordinatorExpertId(team);
    const roster = team.expertIds
      .filter((id) => id !== coordinatorId)
      .map((id) => this.deps?.findExpert(id))
      .filter((e): e is Expert => !!e)
      .map((e) => {
        const role = team.roles?.[e.id];
        return `${e.id}：${e.name}${role ? `（角色：${role}）` : ""}（${e.description}）`;
      })
      .join("\n");
    return [
      sdk.defineTool({
        name: "delegate",
        label: "委派给团队成员",
        description: `将子任务委派给专家团的某一成员，在其独立人格/工具的子会话中执行，结果返回本会话。可并行调用多个成员。\n可用的 expert 值：\n${roster}`,
        parameters: Type.Object({
          expert: Type.String({ description: "团队成员标识（见 description 中的可选值）" }),
          task: Type.String({ description: "要交给该专家执行的子任务描述（尽量具体、自包含）" }),
        }),
        execute: async (toolCallId, params, signal) => {
          const res = await this.runSubagent({
            parentTaskId: ctx.parentTaskId,
            parentToolCallId: toolCallId,
            expertId: params.expert,
            prompt: params.task,
            signal,
            cwd: ctx.cwd,
          });
          return res.status === "ok"
            ? {
                content: [{ type: "text", text: res.text }],
                details: { subagentId: res.subagentId, usage: res.usage },
              }
            : {
                content: [
                  {
                    type: "text",
                    text: `[子代理 ${params.expert} ${res.status === "aborted" ? "已中止" : "执行失败"}] ${
                      res.error ?? ""
                    }`,
                  },
                ],
                details: { subagentId: res.subagentId, usage: res.usage },
              };
        },
      }),
    ];
  }

  // ── 子 Agent 引擎（delegate + workflow 共用） ───────────────────

  /**
   * 执行一个子代理：建隔离子会话 → prompt → 流式 subagent_* 事件 → 返回最终文本/usage。
   * 子报错/中止一律返回不 throw（父 turn 继续）；signal 级联中止子会话；watchdog 防挂死。
   */
  async runSubagent(opts: {
    parentTaskId: string;
    parentToolCallId: string;
    expertId: string;
    prompt: string;
    signal?: AbortSignal;
    onUpdate?: (partial: {
      content: Array<{ type: "text"; text: string }>;
      details: Record<string, unknown>;
    }) => void;
    cwd: string;
    stepId?: string;
    providerId?: string;
  }): Promise<SubagentResult> {
    const deps = this.deps;
    const subagentId = randomUUID();
    const expert = deps?.findExpert(opts.expertId);
    const expertName = expert?.name ?? opts.expertId;
    const failed: SubagentResult = {
      subagentId,
      text: "",
      status: "error",
      error: "团队运行时未就绪",
    };
    if (!deps) return failed;

    // 并发信号量：超上限排队等待
    await this.acquirePermit();

    // 过程累积：最终文本 / 用量 / 错误 / 子工具序列（用于持久化追溯）
    const state = {
      lastText: "",
      usage: null as MessageUsage | null,
      errorMsg: null as string | null,
      tools: [] as SubAgentRunRecord["tools"],
      startedAt: Date.now(),
    };
    let handle: ActiveSubagent | null = null;
    let status: SubagentResult["status"] = "ok";

    this.emit(deps, opts.parentTaskId, {
      type: "subagent_start",
      payload: {
        subagentId,
        parentToolCallId: opts.parentToolCallId,
        expertId: opts.expertId,
        expertName,
        prompt: opts.prompt,
        stepId: opts.stepId,
      },
    });

    try {
      const created = await this.sessionFactory({
        expertId: opts.expertId,
        cwd: opts.cwd,
        providerId: expert?.defaultModelProviderId ?? opts.providerId,
        parentTaskId: opts.parentTaskId,
      });
      handle = {
        subagentId,
        session: created.session,
        dispose: created.dispose,
        parentTaskId: opts.parentTaskId,
      };
      this.active.set(subagentId, handle);

      // 中止级联：父 signal → 子 abort；watchdog 防子会话卡死父工具循环
      let aborted = false;
      const abortChild = () => {
        aborted = true;
        void created.session.abort().catch(() => {});
      };
      opts.signal?.addEventListener("abort", abortChild, { once: true });
      const watchdog = setTimeout(abortChild, TeamRuntime.SUBAGENT_MAX_MS);

      const ctx: SubagentCtx = {
        subagentId,
        parentTaskId: opts.parentTaskId,
        parentToolCallId: opts.parentToolCallId,
        stepId: opts.stepId,
        onUpdate: opts.onUpdate,
      };
      const unsubscribe = created.session.subscribe((event: unknown) => {
        this.translateSubagentEvent(ctx, state, event);
      });
      try {
        await created.session.prompt(opts.prompt);
      } finally {
        clearTimeout(watchdog);
        unsubscribe();
      }
      status = aborted || opts.signal?.aborted ? "aborted" : state.errorMsg ? "error" : "ok";
    } catch (err) {
      status = opts.signal?.aborted ? "aborted" : "error";
      state.errorMsg = state.errorMsg ?? (err instanceof Error ? err.message : String(err));
    } finally {
      if (handle) {
        this.active.delete(subagentId);
        try {
          handle.dispose();
        } catch {
          // 子会话 dispose 失败不阻断
        }
      }
      this.releasePermit();
    }

    this.emit(deps, opts.parentTaskId, {
      type: "subagent_end",
      payload: {
        subagentId,
        parentToolCallId: opts.parentToolCallId,
        stepId: opts.stepId,
        status,
        text: state.lastText || undefined,
        error: state.errorMsg ?? undefined,
        usage: state.usage ?? undefined,
      },
    });

    // 持久化执行过程（供重开后追溯）；同时随结果返回供 workflow 步骤组装
    const record: SubAgentRunRecord = {
      subagentId,
      parentToolCallId: opts.parentToolCallId,
      expertId: opts.expertId,
      expertName,
      prompt: opts.prompt,
      stepId: opts.stepId,
      status,
      text: state.lastText,
      tools: state.tools,
      usage: state.usage ?? undefined,
      error: state.errorMsg ?? undefined,
      startedAt: state.startedAt,
      endedAt: Date.now(),
    };
    teamRunStore.recordSubagent(opts.parentTaskId, record);

    return {
      subagentId,
      text: state.lastText,
      usage: state.usage ?? undefined,
      status,
      error: state.errorMsg ?? undefined,
      record,
    };
  }

  // ── Workflow 引擎（workflow） ───────────────────

  /** 执行团队 workflow（team.workflow 缺省回退 buildDefaultWorkflow）；进度经 workflow_* + subagent_* 推送 */
  async runWorkflow(
    taskId: string,
    teamId: string,
    prompt: string,
    providerId?: string,
  ): Promise<void> {
    const deps = this.deps;
    if (!deps) {
      this.emitError(taskId, "团队运行时未就绪");
      return;
    }
    const task = deps.getTask(taskId);
    const team = deps.getTeam(teamId);
    if (!task || !team) {
      this.emitError(taskId, "任务或团队不存在，无法运行工作流");
      return;
    }
    const members = team.expertIds.map((id) => deps.findExpert(id)).filter((e): e is Expert => !!e);
    const workflow = team.workflow ?? this.buildDefaultWorkflow(team, members);
    const cwd = deps.getTaskCwd(taskId);
    const runAbort = new AbortController();
    const runKey = `wf:${taskId}`;
    this.wfAborts.set(runKey, runAbort);

    this.emit(deps, taskId, {
      type: "workflow_start",
      payload: { workflowId: workflow.id, name: workflow.name, stepCount: workflow.steps.length },
    });

    let aggregate: MessageUsage | null = null;
    const results = new Map<string, string>();
    // 运行过程记录（持久化追溯）：每步完成即写入，整体结束补 summary/status
    const wfRecord: WorkflowRunRecord = {
      runId: taskId,
      workflowId: workflow.id,
      name: workflow.name,
      prompt,
      status: "running",
      steps: [],
      startedAt: Date.now(),
    };

    try {
      for (const step of workflow.steps) {
        const expertIds = collectStepExpertIds(step);
        // 条件节点：进入前先求值（规则只引用前序步骤，结果确定）
        const conditionalPass =
          step.kind === "conditional"
            ? evalWorkflowCondition(step.rules, step.logic, results)
            : undefined;
        this.emit(deps, taskId, {
          type: "workflow_step_start",
          payload: {
            stepId: step.id,
            expertIds,
            prompt: prompt,
            kind: step.kind,
            ...(conditionalPass !== undefined ? { pass: conditionalPass } : {}),
          },
        });
        const children = await this.runStep(
          taskId,
          cwd,
          step,
          prompt,
          results,
          runAbort.signal,
          providerId,
        );
        for (const c of children) if (c.usage) aggregate = addUsage(aggregate, c.usage);
        const output = children.map((c) => c.text).join("\n\n");
        results.set(step.id, output);
        const stepRecord: WorkflowStepRecord = {
          stepId: step.id,
          expertIds,
          kind: step.kind,
          status: children.every((c) => c.status === "ok") ? "ok" : "error",
          output,
          error: children.find((c) => c.error)?.error,
          subagents: children.map((c) => c.record).filter((r): r is SubAgentRunRecord => !!r),
        };
        wfRecord.steps.push(stepRecord);
        teamRunStore.recordWorkflow(taskId, { ...wfRecord });
        this.emit(deps, taskId, {
          type: "workflow_step_end",
          payload: {
            stepId: step.id,
            ok: children.every((c) => c.status === "ok"),
            output,
            error: children.find((c) => c.error)?.error,
            usage: aggregate ?? undefined,
            ...(conditionalPass !== undefined ? { pass: conditionalPass } : {}),
          },
        });
      }

      // 汇总：summarizerExpertId ?? 末位成员
      const summarizerId = workflow.summarizerExpertId ?? members[members.length - 1]?.id;
      if (summarizerId) {
        const stepsText = [...results.entries()].map(([k, v]) => `【${k}】\n${v}`).join("\n\n");
        const summaryPrompt = `请作为团队最终汇总：综合以下各步产出（用户需求「${prompt}」）\n${stepsText}\n\n输出一份结构化总结（结论 + 关键产出 + 后续建议）。`;
        const summary = await this.runSubagent({
          parentTaskId: taskId,
          parentToolCallId: "workflow-summary",
          expertId: summarizerId,
          prompt: summaryPrompt,
          signal: runAbort.signal,
          cwd,
          stepId: "summary",
          providerId,
        });
        if (summary.usage) aggregate = addUsage(aggregate, summary.usage);
        wfRecord.status = summary.status;
        wfRecord.summary = summary.text;
        wfRecord.usage = aggregate ?? undefined;
        wfRecord.error = summary.error;
        this.emit(deps, taskId, {
          type: "workflow_end",
          payload: {
            status: summary.status,
            summary: summary.text,
            error: summary.error,
            usage: aggregate ?? undefined,
          },
        });
      } else {
        wfRecord.status = "ok";
        wfRecord.summary = [...results.values()].join("\n\n");
        wfRecord.usage = aggregate ?? undefined;
        this.emit(deps, taskId, {
          type: "workflow_end",
          payload: {
            status: "ok",
            summary: wfRecord.summary,
            usage: aggregate ?? undefined,
          },
        });
      }
      wfRecord.finishedAt = Date.now();
      teamRunStore.recordWorkflow(taskId, wfRecord);
    } catch (err) {
      wfRecord.status = "error";
      wfRecord.error = err instanceof Error ? err.message : String(err);
      wfRecord.finishedAt = Date.now();
      teamRunStore.recordWorkflow(taskId, wfRecord);
      this.emit(deps, taskId, {
        type: "workflow_end",
        payload: { status: "error", error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      this.wfAborts.delete(runKey);
    }
  }

  /**
   * 执行单个步骤（serial → 1 个子 agent；parallel → 并发多个；conditional → 求值后递归跑分支子链）。
   * 每执行完即把该步骤输出写入 results（分支步骤也写入，供后续 {{id.result}} 引用）。
   */
  private async runStep(
    taskId: string,
    cwd: string,
    step: WorkflowStep,
    userPrompt: string,
    results: Map<string, string>,
    signal: AbortSignal,
    providerId?: string,
  ): Promise<SubagentResult[]> {
    if (step.kind === "serial") {
      const prompt = this.templatePrompt(step.prompt, userPrompt, results);
      const children = [
        await this.runSubagent({
          parentTaskId: taskId,
          parentToolCallId: `wf:${step.id}`,
          expertId: step.expertId,
          prompt,
          signal,
          cwd,
          stepId: step.id,
          providerId,
        }),
      ];
      results.set(step.id, children.map((c) => c.text).join("\n\n"));
      return children;
    }
    if (step.kind === "parallel") {
      const children = await Promise.all(
        step.steps.map((s) =>
          this.runSubagent({
            parentTaskId: taskId,
            parentToolCallId: `wf:${s.id}`,
            expertId: s.expertId,
            prompt: this.templatePrompt(s.prompt, userPrompt, results),
            signal,
            cwd,
            stepId: step.id,
            providerId,
          }),
        ),
      );
      results.set(step.id, children.map((c) => c.text).join("\n\n"));
      return children;
    }
    // conditional：确定性求值 → 走 then/else 子链（递归 runStep；空分支 = 无操作继续）
    const pass = evalWorkflowCondition(step.rules, step.logic, results);
    const branch = pass ? step.thenSteps : (step.elseSteps ?? []);
    const children: SubagentResult[] = [];
    for (const s of branch) {
      children.push(
        ...(await this.runStep(taskId, cwd, s, userPrompt, results, signal, providerId)),
      );
    }
    results.set(step.id, children.map((c) => c.text).join("\n\n"));
    return children;
  }

  /** 提示词模板替换：{user} → 触发消息；{{stepId.result}} → 前步输出 */
  private templatePrompt(prompt: string, userPrompt: string, results: Map<string, string>): string {
    let out = prompt.replaceAll("{user}", userPrompt);
    for (const [k, v] of results) {
      out = out.replaceAll(`{{${k}.result}}`, v);
    }
    return out;
  }

  // ── 中止 / 清理级联 ───────────────────

  /** 中止某任务下所有在途子代理 + workflow 运行（agentRuntime.abort 级联调用） */
  abortForTask(taskId: string): void {
    this.wfAborts.get(`wf:${taskId}`)?.abort();
    for (const handle of this.active.values()) {
      if (handle.parentTaskId === taskId) {
        void handle.session.abort().catch(() => {});
      }
    }
  }

  /** 清理某任务下所有子代理句柄（agentRuntime.disposeSession 级联调用；兜底） */
  disposeForTask(taskId: string): void {
    this.abortForTask(taskId);
    for (const [subId, handle] of this.active) {
      if (handle.parentTaskId === taskId) {
        this.active.delete(subId);
        try {
          handle.dispose();
        } catch {
          // 忽略
        }
      }
    }
  }

  // ── 私有 ───────────────────

  private emit(deps: TeamRuntimeDeps, streamId: string, evt: WithoutStreamId<AgentEvent>): void {
    deps.emitTo(streamId, evt);
  }

  private emitError(taskId: string, message: string): void {
    this.deps?.emitTo(taskId, { type: "error", payload: { message } });
  }

  /** 真实子会话工厂：buildSessionConfig（headless）+ SessionManager.inMemory + createAgentSession */
  private async realSubagentSessionFactory(opts: {
    expertId: string;
    cwd: string;
    providerId?: string;
    parentTaskId: string;
  }): Promise<{ session: AgentSession; dispose: () => void }> {
    const deps = this.deps;
    if (!deps) throw new Error("团队运行时未就绪");
    const sdk = await deps.loadSdk();
    let modelRuntime = deps.getModelRuntime();
    if (!modelRuntime) {
      await deps.ensureModelRuntime();
      modelRuntime = deps.getModelRuntime();
    }
    if (!modelRuntime) throw new Error("ModelRuntime 未就绪");
    const expert = deps.findExpert(opts.expertId);
    const built = await buildSessionConfig({
      sdk,
      modelRuntime,
      availability: deps.getAvailability(),
      cwd: opts.cwd,
      mode: expert?.mode ?? "daily",
      expert,
      providerId: expert?.defaultModelProviderId ?? opts.providerId,
      emit: (evt) => deps.emitTo(opts.parentTaskId, evt),
      getMode: () => "auto",
      resolveModel: (pid) => deps.resolveModel(pid),
      headless: true,
    });
    const sessionManager = sdk.SessionManager.inMemory(opts.cwd) as SessionManagerInstance;
    const { session } = await sdk.createAgentSession({
      cwd: opts.cwd,
      model: built.model,
      modelRuntime,
      sessionManager,
      tools: built.toolAllowlist,
      customTools: built.customTools,
      resourceLoader: built.resourceLoader,
    });
    return {
      session,
      dispose: () => {
        try {
          session.dispose();
        } catch {
          // 忽略
        }
      },
    };
  }

  /**
   * 子会话 SDK 事件 → subagent_* 事件（独立于 agentRuntime.translateAndEmit——
   * 复用后者会把子文本当成父 assistant 消息注入）。文本 delta 同时经 onUpdate 喂父 delegate
   * 工具卡的 tool_execution_update（渲染层零改动可见流式）。
   */
  private translateSubagentEvent(
    ctx: SubagentCtx,
    state: {
      lastText: string;
      usage: MessageUsage | null;
      errorMsg: string | null;
      tools: SubAgentRunRecord["tools"];
    },
    event: unknown,
  ): void {
    const e = event as { type: string; [k: string]: unknown };
    const base = {
      subagentId: ctx.subagentId,
      parentToolCallId: ctx.parentToolCallId,
      ...(ctx.stepId !== undefined ? { stepId: ctx.stepId } : {}),
    };
    const emit = (ev: WithoutStreamId<AgentEvent>) =>
      this.emit(this.deps as TeamRuntimeDeps, ctx.parentTaskId, ev);
    // 子工具序列累积（按 toolCallId 升位，保留最新 phase/output），供持久化追溯
    const upsertTool = (t: SubAgentRunRecord["tools"][number]) => {
      const i = state.tools.findIndex((x) => x.toolCallId === t.toolCallId);
      if (i >= 0) state.tools[i] = t;
      else state.tools.push(t);
    };

    switch (e.type) {
      case "message_update": {
        const ame = e.assistantMessageEvent as
          | { type?: string; delta?: string; content?: string }
          | undefined;
        if (!ame) return;
        if (ame.type === "text_delta" && typeof ame.delta === "string") {
          state.lastText += ame.delta;
          emit({ type: "subagent_delta", payload: { ...base, delta: ame.delta } });
          ctx.onUpdate?.({ content: [{ type: "text", text: ame.delta }], details: {} });
        } else if (ame.type === "text_end" && typeof ame.content === "string") {
          // text_end.content 是累计全文，以它为准，避免与 delta 累加重复
          state.lastText = ame.content;
        }
        break;
      }
      case "tool_execution_start": {
        const toolCallId = e.toolCallId as string;
        const toolName = e.toolName as string;
        upsertTool({ toolName, toolCallId, phase: "start" });
        emit({
          type: "subagent_tool",
          payload: { ...base, toolName, toolCallId, args: e.args, phase: "start" },
        });
        break;
      }
      case "tool_execution_update": {
        const toolCallId = e.toolCallId as string;
        const toolName = e.toolName as string;
        upsertTool({ toolName, toolCallId, phase: "update", output: e.partialResult });
        emit({
          type: "subagent_tool",
          payload: { ...base, toolName, toolCallId, phase: "update", output: e.partialResult },
        });
        break;
      }
      case "tool_execution_end": {
        const toolCallId = e.toolCallId as string;
        const toolName = e.toolName as string;
        const error = e.isError ? String(e.result ?? "执行失败") : undefined;
        upsertTool({ toolName, toolCallId, phase: "end", output: e.result, error });
        emit({
          type: "subagent_tool",
          payload: {
            ...base,
            toolName,
            toolCallId,
            phase: "end",
            ok: !e.isError,
            output: e.result,
            error,
          },
        });
        break;
      }
      case "message_end": {
        const msg = e.message as { role?: string; usage?: MessageUsage } | undefined;
        if (msg?.role === "assistant" && msg.usage) {
          state.usage = addUsage(state.usage, msg.usage);
        }
        break;
      }
      case "error": {
        const err = e as { message?: string; error?: { message?: string } };
        state.errorMsg = state.errorMsg ?? err.error?.message ?? err.message ?? "子代理执行失败";
        break;
      }
      default:
        break;
    }
  }

  /** 并发信号量：获取许可（超 MAX_CONCURRENT 排队） */
  private acquirePermit(): Promise<void> {
    if (this.running < TeamRuntime.MAX_CONCURRENT) {
      this.running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  /** 释放许可（唤醒下一个排队者） */
  private releasePermit(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.running = Math.max(0, this.running - 1);
  }
}

export const teamRuntime = new TeamRuntime();
