/**
 * workflowGraph - workflow（嵌套 WorkflowStep[]）↔ 画布图（nodes + edges）的纯映射。
 *
 * 画布是结构化画布：执行序仍由嵌套 steps 数组序决定，画布节点携带对步骤的引用；
 * 这里只负责 ① 由嵌套模型派生 React Flow 的 nodes/edges（含条件 then/else 分支边），
 * ② 反向由 nodes 重建嵌套 steps + 画布坐标（供 roundtrip 单测与保存兜底）。
 * 纯函数、无 React/@xyflow 依赖，便于单测。
 */

import type { TeamWorkflow, WorkflowStep } from "@everybuddy/ipc-contract";

/** 画布节点类型：serial/parallel/conditional 对应步骤；summary 是虚拟末端（映射 summarizerExpertId） */
export type GraphNodeKind = "serial" | "parallel" | "conditional" | "summary";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  /** 条件分支子节点所属分支；顶层节点无 */
  branch?: "then" | "else";
  /** 条件分支子节点所属条件节点 id */
  parentId?: string;
  /** 顶层链条中的序号（workflowToGraph 赋值，graphToWorkflow 用它重建顺序） */
  seq?: number;
  position: { x: number; y: number };
  /** 原始步骤引用（serial/parallel/conditional 为真实步骤；summary 为伪步骤） */
  data: WorkflowStep;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: "out" | "then" | "else";
  targetHandle: "in";
  kind: "chain" | "branch";
  branch?: "then" | "else";
  label?: string;
}

// ── 布局常量（workflow.layout 未提供坐标时的自动布局） ──
const TOP_X = 40;
const TOP_GAP = 140;
const BRANCH_ROW = 120;
const THEN_X = 420;
const ELSE_X = 720;

/** 伪汇总步骤：仅画布展示末端用，不写入 steps */
function virtualSummaryStep(workflow: TeamWorkflow): WorkflowStep | null {
  const id = workflow.summarizerExpertId;
  if (!id) return null;
  return { kind: "serial", id: "__summary", expertId: id, prompt: "" };
}

/** 由嵌套 workflow 派生画布 nodes + edges（含自动布局） */
export function workflowToGraph(workflow: TeamWorkflow): {
  nodes: GraphNode[];
  edges: GraphEdge[];
} {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const topIds: string[] = [];
  let seq = 0;
  let y = 40;

  const place = (id: string, x: number, yy: number): { x: number; y: number } =>
    workflow.layout?.[id] ?? { x, y: yy };

  for (const step of workflow.steps) {
    topIds.push(step.id);
    seq++;
    nodes.push({
      id: step.id,
      kind: step.kind,
      seq,
      position: place(step.id, TOP_X, y),
      data: step,
    });
    if (step.kind === "conditional") {
      const branches: Array<["then" | "else", WorkflowStep[]]> = [
        ["then", step.thenSteps],
        ["else", step.elseSteps ?? []],
      ];
      for (const [branch, list] of branches) {
        const x = branch === "then" ? THEN_X : ELSE_X;
        list.forEach((child, i) => {
          seq++;
          nodes.push({
            id: child.id,
            kind: child.kind,
            branch,
            parentId: step.id,
            seq,
            position: place(child.id, x, y + i * BRANCH_ROW),
            data: child,
          });
          if (i === 0) {
            edges.push({
              id: `e:${step.id}->${child.id}`,
              source: step.id,
              target: child.id,
              sourceHandle: branch,
              targetHandle: "in",
              kind: "branch",
              branch,
              label: branch === "then" ? "✓" : "✗",
            });
          } else {
            const prev = list[i - 1] as WorkflowStep; // i>0，必有前驱
            edges.push({
              id: `e:${prev.id}->${child.id}`,
              source: prev.id,
              target: child.id,
              sourceHandle: "out",
              targetHandle: "in",
              kind: "branch",
              branch,
            });
          }
        });
      }
      y += TOP_GAP;
    } else {
      y += TOP_GAP;
    }
  }

  // 顶层链条边（i 在界内，非空）
  for (let i = 0; i < topIds.length - 1; i++) {
    const src = topIds[i] as string;
    const dst = topIds[i + 1] as string;
    edges.push({
      id: `e:${src}->${dst}`,
      source: src,
      target: dst,
      sourceHandle: "out",
      targetHandle: "in",
      kind: "chain",
    });
  }

  // 虚拟汇总末端节点
  const summary = virtualSummaryStep(workflow);
  if (summary) {
    seq++;
    nodes.push({
      id: summary.id,
      kind: "summary",
      seq,
      position: place(summary.id, TOP_X, y),
      data: summary,
    });
    if (topIds.length > 0) {
      const last = topIds[topIds.length - 1] as string;
      edges.push({
        id: `e:${last}->${summary.id}`,
        source: last,
        target: summary.id,
        sourceHandle: "out",
        targetHandle: "in",
        kind: "chain",
      });
    }
  }

  return { nodes, edges };
}

/** 由画布 nodes 重建嵌套 steps + 画布坐标 + 汇总专家（top 顺序取 seq；summary 伪节点不写入 steps） */
export function graphToWorkflow(
  nodes: GraphNode[],
  meta: Pick<TeamWorkflow, "id" | "name" | "description">,
): TeamWorkflow {
  const top = nodes
    .filter((n) => !n.branch && n.kind !== "summary")
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const steps: WorkflowStep[] = [];
  let summarizerExpertId: string | undefined;
  const layout: Record<string, { x: number; y: number }> = {};

  for (const n of nodes) layout[n.id] = { x: n.position.x, y: n.position.y };
  const summaryNode = nodes.find((n) => n.kind === "summary");
  const sumData = summaryNode?.data as { expertId?: string } | undefined;
  if (summaryNode && sumData?.expertId) {
    summarizerExpertId = sumData.expertId;
    delete layout[summaryNode.id];
  }

  for (const node of top) {
    if (node.kind === "conditional") {
      const data = node.data as Extract<WorkflowStep, { kind: "conditional" }>;
      const rebuild = (branch: "then" | "else") =>
        nodes
          .filter((n) => n.branch === branch && n.parentId === node.id)
          .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
          .map((n) => n.data as WorkflowStep);
      steps.push({ ...data, thenSteps: rebuild("then"), elseSteps: rebuild("else") });
    } else {
      steps.push(node.data as WorkflowStep);
    }
  }

  return {
    ...meta,
    steps,
    layout,
    ...(summarizerExpertId ? { summarizerExpertId } : {}),
  };
}

/** 步骤 id 全局唯一校验（重复会互相覆盖 results，运行时行为异常） */
export function workflowStepsValid(steps: WorkflowStep[]): { ok: boolean; error?: string } {
  const seen = new Set<string>();
  const check = (list: WorkflowStep[]): boolean => {
    for (const s of list) {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      if (s.kind === "conditional") {
        if (!check(s.thenSteps)) return false;
        if (s.elseSteps && !check(s.elseSteps)) return false;
      }
    }
    return true;
  };
  if (steps.length === 0) return { ok: false, error: "needNodes" };
  return check(steps) ? { ok: true } : { ok: false, error: "duplicateNodeId" };
}
