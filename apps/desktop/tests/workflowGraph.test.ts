/**
 * workflowGraph 单元测试：嵌套 workflow ↔ 画布图（nodes + edges）往返一致。
 */

import type { TeamWorkflow } from "@everybuddy/ipc-contract";
import { describe, expect, it } from "vitest";
import {
  graphToWorkflow,
  workflowStepsValid,
  workflowToGraph,
} from "../src/renderer/components/expert/workflowGraph";

const wf: TeamWorkflow = {
  id: "wf-1",
  name: "门禁流程",
  description: "分析→并行→评审→条件→发布/修复→汇总",
  steps: [
    { kind: "serial", id: "analysis", expertId: "daily", prompt: "分析：{user}" },
    {
      kind: "parallel",
      id: "dev",
      steps: [
        { id: "design", expertId: "coding", prompt: "设计" },
        { id: "doc", expertId: "daily", prompt: "文档" },
      ],
    },
    { kind: "serial", id: "review", expertId: "daily", prompt: "审查 {{dev.result}}" },
    {
      kind: "conditional",
      id: "gate",
      logic: "and",
      rules: [{ var: "review", op: "contains", value: "通过" }],
      thenSteps: [
        { kind: "serial", id: "publish", expertId: "ops", prompt: "发布 {{review.result}}" },
      ],
      elseSteps: [
        { kind: "serial", id: "fix", expertId: "coding", prompt: "修复 {{review.result}}" },
      ],
    },
  ],
  summarizerExpertId: "daily",
};

describe("workflowToGraph", () => {
  it("顶层链条边 + 条件 then/else 分支边 + 并行成员 + 虚拟汇总节点", () => {
    const { nodes, edges } = workflowToGraph(wf);

    const ids = nodes.map((n) => n.id);
    // 顶层 + 分支 + 汇总
    expect(ids).toEqual(
      expect.arrayContaining(["analysis", "dev", "review", "gate", "publish", "fix", "__summary"]),
    );

    // 链边：analysis→dev→review→gate→summary
    const chain = edges.filter((e) => e.kind === "chain").map((e) => `${e.source}->${e.target}`);
    expect(chain).toContain("analysis->dev");
    expect(chain).toContain("dev->review");
    expect(chain).toContain("review->gate");
    expect(chain).toContain("gate->__summary");

    // 条件分支边
    const thenEdge = edges.find((e) => e.branch === "then");
    expect(thenEdge).toMatchObject({
      source: "gate",
      target: "publish",
      sourceHandle: "then",
      label: "✓",
    });
    const elseEdge = edges.find((e) => e.branch === "else");
    expect(elseEdge).toMatchObject({
      source: "gate",
      target: "fix",
      sourceHandle: "else",
      label: "✗",
    });

    // 并行成员节点（带 branch 标记 + 所属条件）
    const pub = nodes.find((n) => n.id === "publish");
    expect(pub).toMatchObject({ branch: "then", parentId: "gate" });
    const sum = nodes.find((n) => n.id === "__summary");
    expect(sum?.kind).toBe("summary");
  });

  it("workflow.layout 提供坐标时使用该坐标（否则自动布局）", () => {
    const laid: TeamWorkflow = { ...wf, layout: { analysis: { x: 100, y: 200 } } };
    const { nodes } = workflowToGraph(laid);
    expect(nodes.find((n) => n.id === "analysis")?.position).toEqual({ x: 100, y: 200 });
  });
});

describe("graphToWorkflow 往返", () => {
  it("nodes → steps 与原始 workflow 一致（含条件嵌套、并行成员、汇总）", () => {
    const { nodes } = workflowToGraph(wf);
    const rebuilt = graphToWorkflow(nodes, wf);
    expect(rebuilt.steps).toEqual(wf.steps);
    expect(rebuilt.summarizerExpertId).toBe("daily");
    expect(rebuilt.id).toBe("wf-1");
    // layout 收集全部节点坐标（summary 伪节点剔除）
    expect(rebuilt.layout?.analysis).toEqual(nodes.find((n) => n.id === "analysis")?.position);
    expect(rebuilt.layout?.__summary).toBeUndefined();
  });

  it("无汇总专家时不生成 summary 节点", () => {
    const noSum: TeamWorkflow = { ...wf, summarizerExpertId: undefined };
    const { nodes } = workflowToGraph(noSum);
    expect(nodes.some((n) => n.id === "__summary")).toBe(false);
    const rebuilt = graphToWorkflow(nodes, noSum);
    expect(rebuilt.steps).toEqual(noSum.steps);
    expect(rebuilt.summarizerExpertId).toBeUndefined();
  });
});

describe("workflowStepsValid", () => {
  it("空流程 → needNodes", () => {
    expect(workflowStepsValid([])).toEqual({ ok: false, error: "needNodes" });
  });
  it("重复步骤 ID（含分支内）→ duplicateNodeId", () => {
    const dup: TeamWorkflow["steps"] = [
      { kind: "serial", id: "a", expertId: "daily", prompt: "x" },
      {
        kind: "conditional",
        id: "gate",
        logic: "and",
        rules: [],
        thenSteps: [{ kind: "serial", id: "a", expertId: "daily", prompt: "y" }],
      },
    ];
    expect(workflowStepsValid(dup)).toEqual({ ok: false, error: "duplicateNodeId" });
  });
  it("合法 → ok", () => {
    expect(workflowStepsValid(wf.steps)).toEqual({ ok: true });
  });
});
