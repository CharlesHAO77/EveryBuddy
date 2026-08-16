/**
 * WorkflowCanvas - 结构化画布 workflow 设计器（@xyflow/react）。
 *
 * 设计定位：专家配置留在专家中心，这里只编排流程、引用系统专家（expertId）。
 * 结构由嵌套 WorkflowStep[]（team.workflow）派生，画布是可视化视图：
 *  - 执行序 = steps 数组序；画布拖动只改视觉位置（写入 workflow.layout，引擎忽略）。
 *  - 节点类型：任务（串行）/ 并行 / 条件（if-else，then/else 分支子节点挂到条件节点两侧）/ 汇总（虚拟末端）。
 *  - 右侧面板编辑选中节点；左侧 rail 添加节点；条件规则为确定性规则（本地判断，零 token）。
 */

import {
  applyNodeChanges,
  Background,
  Controls,
  type Edge,
  Handle,
  MiniMap,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnNodeDrag,
  type OnNodesChange,
  Position,
  ReactFlow,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type {
  TeamWorkflow,
  WorkflowConditionOp,
  WorkflowStep,
  WorkflowStepRef,
} from "@everybuddy/ipc-contract";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type GraphNode,
  type GraphNodeKind,
  workflowStepsValid,
  workflowToGraph,
} from "./workflowGraph";

// ── 专家成员选项 ──
export interface WorkflowMember {
  id: string;
  name: string;
}

// ── 节点类型元信息（画布徽章配色） ──
const KIND_META: Record<GraphNodeKind, { label: string; badgeCls: string; cardCls: string }> = {
  serial: { label: "任务", badgeCls: "bg-active text-ink-2", cardCls: "" },
  parallel: {
    label: "并行",
    badgeCls: "bg-accent-tint text-accent-strong",
    cardCls: "border-accent-line",
  },
  conditional: {
    label: "条件",
    badgeCls: "bg-purple-tint text-purple",
    cardCls: "border-purple-line",
  },
  summary: { label: "汇总", badgeCls: "bg-warn-tint text-warn", cardCls: "border-warn-line" },
};

const CONDITION_OPS: Array<{ id: WorkflowConditionOp; label: string }> = [
  { id: "contains", label: "包含" },
  { id: "not_contains", label: "不包含" },
  { id: "is_empty", label: "为空" },
  { id: "is_not_empty", label: "不为空" },
  { id: "equals", label: "等于" },
  { id: "not_equals", label: "不等于" },
  { id: "starts_with", label: "以…开头" },
  { id: "ends_with", label: "以…结尾" },
  { id: "len_gt", label: "长度 >" },
  { id: "len_lt", label: "长度 <" },
];

function opLabel(op: WorkflowConditionOp): string {
  return CONDITION_OPS.find((o) => o.id === op)?.label ?? op;
}

// ── 嵌套 steps 的工具函数（不可变更新） ──

function mapSteps(steps: WorkflowStep[], fn: (s: WorkflowStep) => WorkflowStep): WorkflowStep[] {
  return steps.map((s) => {
    const next = fn(s);
    if (next.kind === "conditional") {
      return {
        ...next,
        thenSteps: mapSteps(next.thenSteps, fn),
        elseSteps: next.elseSteps ? mapSteps(next.elseSteps, fn) : next.elseSteps,
      };
    }
    return next;
  });
}

function removeStepFrom(steps: WorkflowStep[], id: string): WorkflowStep[] {
  return steps
    .filter((s) => s.id !== id)
    .map((s) =>
      s.kind === "conditional"
        ? {
            ...s,
            thenSteps: removeStepFrom(s.thenSteps, id),
            elseSteps: s.elseSteps ? removeStepFrom(s.elseSteps, id) : s.elseSteps,
          }
        : s,
    );
}

function collectStepIds(steps: WorkflowStep[]): string[] {
  const ids: string[] = [];
  for (const s of steps) {
    ids.push(s.id);
    if (s.kind === "parallel") ids.push(...s.steps.map((r) => r.id));
    if (s.kind === "conditional") {
      ids.push(...collectStepIds(s.thenSteps));
      if (s.elseSteps) ids.push(...collectStepIds(s.elseSteps));
    }
  }
  return ids;
}

function nextNodeId(workflow: TeamWorkflow, kind: GraphNodeKind): string {
  const used = new Set(collectStepIds(workflow.steps));
  const prefix = kind === "conditional" ? "gate" : kind === "parallel" ? "dev" : "step";
  let n = 1;
  while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

// ── 自定义节点组件 ──

type CardData = { graph: GraphNode };

function CardNode({ data, selected }: NodeProps) {
  const g = (data as CardData).graph;
  const meta = KIND_META[g.kind];
  const cond = g.kind === "conditional";
  return (
    <div
      className={`w-[248px] rounded-[12px] border bg-card px-[12px] py-[10px] shadow-card transition ${meta.cardCls} ${
        selected ? "border-accent ring-[3px] ring-accent-tint" : "border-line"
      }`}
    >
      <Handle type="target" position={Position.Top} id="in" />
      {cond ? (
        <>
          <Handle
            type="source"
            position={Position.Left}
            id="then"
            className="!bg-accent"
            style={{ top: "62%" }}
          />
          <Handle
            type="source"
            position={Position.Right}
            id="else"
            className="!bg-warn"
            style={{ top: "62%" }}
          />
          <Handle type="source" position={Position.Bottom} id="out" />
        </>
      ) : (
        <Handle type="source" position={Position.Bottom} id="out" />
      )}
      <div className="flex items-center gap-[7px]">
        <span className={`rounded-[6px] px-[8px] py-[1px] text-[10px] font-bold ${meta.badgeCls}`}>
          {meta.label}
        </span>
        <span className="font-mono text-[11px] font-bold text-ink-3">{g.id}</span>
        {g.branch ? (
          <span
            className={`rounded-full px-[6px] py-[0px] text-[9px] font-bold ${
              g.branch === "then" ? "bg-accent-tint text-accent-strong" : "bg-warn-tint text-warn"
            }`}
          >
            {g.branch === "then" ? "✓ 满足" : "✗ 否则"}
          </span>
        ) : null}
      </div>
      {nodeSummary(g)}
    </div>
  );
}

function nodeSummary(g: GraphNode): ReactNode {
  const s = g.data;
  if (s.kind === "parallel") {
    return (
      <div className="mt-[7px] flex flex-wrap gap-[5px]">
        {s.steps.map((r) => (
          <span
            key={r.id}
            className="rounded-[6px] bg-accent-tint px-[7px] py-[1px] text-[10.5px] font-medium text-accent-strong"
          >
            {r.expertId}
          </span>
        ))}
      </div>
    );
  }
  if (s.kind === "conditional") {
    return (
      <div className="mt-[7px] truncate font-mono text-[10.5px] text-purple">
        {s.rules.length > 0
          ? s.rules
              .map((r) => `{{${r.var}.result}} ${opLabel(r.op)} ${r.value ?? ""}`)
              .join(s.logic === "or" ? " 或 " : " 且 ")
          : "（无条件规则）"}
      </div>
    );
  }
  if (g.kind === "summary") {
    return (
      <div className="mt-[7px] text-[12px] font-semibold text-ink-2">
        {s.expertId || "—"} · 输出最终总结
      </div>
    );
  }
  return (
    <div className="mt-[7px] line-clamp-2 text-[11.5px] leading-[1.4] text-ink-2">
      {(s.prompt || "").slice(0, 60)}
    </div>
  );
}

const nodeTypes: NodeTypes = {
  serial: CardNode,
  parallel: CardNode,
  conditional: CardNode,
  summary: CardNode,
};

/** 嵌套 workflow → React Flow nodes（位置取自 workflow.layout；结构变化时重建画布用） */
function toRfNodes(workflow: TeamWorkflow, selectedId: string | null): Node[] {
  return workflowToGraph(workflow).nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: n.position,
    data: { graph: n },
    selected: n.id === selectedId,
  }));
}

/** 嵌套 workflow → React Flow edges（条件 then/else 分支着色 + 标签） */
function toRfEdges(workflow: TeamWorkflow): Edge[] {
  return workflowToGraph(workflow).edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    ...(e.label ? { label: e.label } : {}),
    style: {
      stroke: e.branch === "then" ? "#0d7a5f" : e.branch === "else" ? "#b8862f" : "#a39e93",
      strokeWidth: e.branch ? 2.4 : 2,
      ...(e.branch === "else" ? { strokeDasharray: "6 4" } : {}),
    },
    labelStyle: { fill: e.branch === "then" ? "#0d7a5f" : "#b8862f", fontWeight: 700 },
    labelBgStyle: { fill: "#fff" },
    labelBgPadding: [4, 2] as [number, number],
  }));
}

/** 结构变化后重新适配画布（新增节点可见） */
function FitViewOnChange({ revision }: { revision: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (revision > 0) void fitView({ padding: 0.15, duration: 200 });
  }, [revision, fitView]);
  return null;
}

// ── 主组件 ──

export function WorkflowCanvas({
  workflow,
  onChange,
  members,
}: {
  workflow: TeamWorkflow;
  onChange: (wf: TeamWorkflow) => void;
  members: WorkflowMember[];
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  // 画布节点/边由本地状态驱动：拖动经 applyNodeChanges 直接改本地，只在拖动结束把位置
  // 写回 workflow.layout —— 消除「每帧往返 workflow → 重派生 → 节点重建 → 闪烁」。
  // 结构变化（steps 增删改 / 汇总专家）经 effect 重建，布局仍从 workflow.layout 读取。
  const [flowNodes, setFlowNodes] = useState<Node[]>(() => toRfNodes(workflow, null));
  const [flowEdges, setFlowEdges] = useState<Edge[]>(() => toRfEdges(workflow));
  const [revision, setRevision] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅结构变化重建画布；拖动位置走本地状态，不依赖整个 workflow（布局变化不重建）
  useEffect(() => {
    setFlowNodes(toRfNodes(workflow, selectedIdRef.current));
    setFlowEdges(toRfEdges(workflow));
    // 注意：不在此 bump revision —— 提示词编辑也改 workflow.steps，若这里触发会随每次键入重新适配视图
  }, [workflow.steps, workflow.summarizerExpertId]);

  const onNodesChange: OnNodesChange = useCallback(
    (changes) => setFlowNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  // 拖动结束：把全部节点最终位置写回 workflow.layout（只改视觉，不动执行序）
  const onNodeDragStop: OnNodeDrag<Node> = useCallback(
    (_, __, nodes) => {
      onChange({
        ...workflow,
        layout: Object.fromEntries(nodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }])),
      });
    },
    [onChange, workflow],
  );

  const expertName = (id: string) => members.find((m) => m.id === id)?.name ?? id;
  const selected =
    (flowNodes.find((n) => n.id === selectedId)?.data as { graph?: GraphNode } | undefined)
      ?.graph ?? null;
  const nodeCount = flowNodes.length;
  const validate = workflowStepsValid(workflow.steps);

  const updateStep = (id: string, patch: (s: WorkflowStep) => WorkflowStep) =>
    onChange({ ...workflow, steps: mapSteps(workflow.steps, (s) => (s.id === id ? patch(s) : s)) });

  const removeStep = (id: string) => {
    const layout = { ...(workflow.layout ?? {}) };
    delete layout[id];
    onChange({ ...workflow, steps: removeStepFrom(workflow.steps, id), layout });
    setSelectedId((cur) => (cur === id ? null : cur));
    setRevision((v) => v + 1);
  };

  const duplicateStep = (id: string) => {
    const src = findStep(workflow.steps, id);
    if (!src) return;
    const copy = structuredClone(src);
    copy.id = nextNodeId(workflow, copy.kind);
    if (copy.kind === "parallel") {
      copy.steps = copy.steps.map((r) => ({ ...r, id: `${copy.id}-${r.id}` }));
    }
    // 复制到同一分支/顶层：简单起见追加到顶层末尾
    onChange({ ...workflow, steps: [...workflow.steps, copy] });
    setRevision((v) => v + 1);
  };

  const addStep = (
    kind: "serial" | "parallel" | "conditional",
    target?: { parentId: string; branch: "then" | "else" },
  ) => {
    const id = nextNodeId(workflow, kind);
    const first = members[0]?.id ?? "daily";
    const make = (): WorkflowStep => {
      if (kind === "parallel") {
        const refs: WorkflowStepRef[] = [first, members[1]?.id ?? first].map((ex, i) => ({
          id: `${id}-${i + 1}`,
          expertId: ex,
          prompt: `你是${expertName(ex)}：针对「{user}」完成你的部分。`,
        }));
        return { kind, id, steps: refs };
      }
      if (kind === "conditional")
        return { kind, id, logic: "and", rules: [], thenSteps: [], elseSteps: [] };
      return {
        kind,
        id,
        expertId: first,
        prompt: `你是${expertName(first)}：针对「{user}」完成你的部分。`,
      };
    };
    const node = make();
    if (target) {
      onChange({
        ...workflow,
        steps: mapSteps(workflow.steps, (s) =>
          s.id === target.parentId && s.kind === "conditional"
            ? {
                ...s,
                thenSteps: target.branch === "then" ? [...s.thenSteps, node] : s.thenSteps,
                elseSteps: s.elseSteps
                  ? target.branch === "else"
                    ? [...s.elseSteps, node]
                    : s.elseSteps
                  : target.branch === "else"
                    ? [node]
                    : s.elseSteps,
              }
            : s,
        ),
      });
    } else {
      onChange({ ...workflow, steps: [...workflow.steps, node] });
    }
    setSelectedId(id);
    setRevision((v) => v + 1);
  };

  const moveTop = (id: string, dir: -1 | 1) => {
    const idx = workflow.steps.findIndex((s) => s.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= workflow.steps.length) return;
    const steps = [...workflow.steps];
    const a = steps[idx];
    const b = steps[j];
    if (!a || !b) return;
    steps[idx] = b;
    steps[j] = a;
    onChange({ ...workflow, steps });
    setRevision((v) => v + 1);
  };

  const setSummarizer = (expertId: string) =>
    onChange({ ...workflow, summarizerExpertId: expertId || undefined });

  return (
    <div className="flex h-full min-h-[460px] overflow-hidden rounded-[14px] border border-line bg-paper">
      {/* 左侧节点库 */}
      <div className="flex w-[132px] shrink-0 flex-col gap-[8px] border-r border-line bg-paper-deep p-[12px]">
        <div className="px-[2px] text-[11px] font-bold tracking-[0.05em] text-ink-3">
          {t("expert.workflow.railLabel")}
        </div>
        {(
          [
            ["serial", "＋ 任务"],
            ["parallel", "＋ 并行"],
            ["conditional", "＋ 条件"],
          ] as const
        ).map(([kind, label]) => (
          <button
            key={kind}
            type="button"
            onClick={() => addStep(kind)}
            className="rounded-[10px] border border-line bg-card px-[10px] py-[9px] text-left text-[12.5px] font-semibold text-ink-2 transition hover:border-accent-line hover:text-accent"
          >
            {label}
          </button>
        ))}
        <div className="mt-[6px] px-[2px] text-[10.5px] leading-[1.5] text-ink-3">
          {t("expert.workflow.railHint")}
        </div>
      </div>

      {/* 画布 */}
      <div className="relative min-w-0 flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          onPaneClick={() => setSelectedId(null)}
          onNodeDragStop={onNodeDragStop}
          fitView
          minZoom={0.35}
          maxZoom={1.6}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "smoothstep" }}
        >
          <Background gap={22} color="#e5e0d6" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            className="!bg-card"
            nodeColor="#c9c2b4"
            maskColor="rgb(31 28 24 / 0.06)"
          />
          <FitViewOnChange revision={revision} />
        </ReactFlow>
      </div>

      {/* 右侧编辑面板 */}
      <div className="flex w-[300px] shrink-0 flex-col border-l border-line bg-card">
        <div className="border-b border-line px-[14px] py-[12px]">
          <div className="flex items-center gap-[8px] text-[13.5px] font-bold">
            {selected ? (
              <>
                <span
                  className={`rounded-[6px] px-[8px] py-[1px] text-[10px] font-bold ${
                    KIND_META[selected.kind].badgeCls
                  }`}
                >
                  {KIND_META[selected.kind].label}
                </span>
                <span className="font-mono text-ink-3">{selected.id}</span>
              </>
            ) : (
              <span className="text-ink-2">{t("expert.workflow.panelEmpty")}</span>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[14px] py-[14px]">
          {selected ? (
            <NodeEditor
              graph={selected}
              members={members}
              expertName={expertName}
              updateStep={updateStep}
              removeStep={removeStep}
              duplicateStep={duplicateStep}
              addStep={addStep}
              setSummarizer={setSummarizer}
              moveTop={moveTop}
            />
          ) : (
            <div className="text-[12px] leading-[1.6] text-ink-3">
              <div className="mb-[8px] font-semibold">{t("expert.workflow.chainNote")}</div>
              <div className="flex items-center gap-[6px]">
                {validate.ok ? (
                  <span className="rounded-full bg-accent-tint px-[8px] py-[1px] text-[11px] font-bold text-accent-strong">
                    ✓ {nodeCount} 节点
                  </span>
                ) : (
                  <span className="rounded-full bg-danger/10 px-[8px] py-[1px] text-[11px] font-bold text-danger">
                    {t(`expert.workflow.${validate.error ?? "needNodes"}`)}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="border-t border-line bg-paper px-[14px] py-[10px]">
          <div className="mb-[4px] text-[10.5px] font-bold tracking-[0.04em] text-ink-2">
            {t("expert.workflow.summarizerLabel")}
          </div>
          <select
            className="w-full rounded-[8px] border border-line bg-card px-[10px] py-[7px] text-[12.5px] outline-none focus:border-accent"
            value={workflow.summarizerExpertId ?? ""}
            onChange={(e) => setSummarizer(e.target.value)}
          >
            <option value="">—</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function findStep(steps: WorkflowStep[], id: string): WorkflowStep | undefined {
  for (const s of steps) {
    if (s.id === id) return s;
    if (s.kind === "conditional") {
      const found =
        findStep(s.thenSteps, id) ?? (s.elseSteps ? findStep(s.elseSteps, id) : undefined);
      if (found) return found;
    }
  }
  return undefined;
}

// ── 选中节点编辑器 ──

function NodeEditor({
  graph,
  members,
  expertName,
  updateStep,
  removeStep,
  duplicateStep,
  addStep,
  setSummarizer,
  moveTop,
}: {
  graph: GraphNode;
  members: WorkflowMember[];
  expertName: (id: string) => string;
  updateStep: (id: string, patch: (s: WorkflowStep) => WorkflowStep) => void;
  removeStep: (id: string) => void;
  duplicateStep: (id: string) => void;
  addStep: (
    kind: "serial" | "parallel" | "conditional",
    target?: { parentId: string; branch: "then" | "else" },
  ) => void;
  setSummarizer: (expertId: string) => void;
  /** 顶层链条上移/下移（改执行序） */
  moveTop: (id: string, dir: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const s = graph.data;

  const expertOptions = useMemo(() => {
    const known = new Set(members.map((m) => m.id));
    const extra = new Set<string>();
    const scan = (steps: WorkflowStep[]) => {
      for (const x of steps) {
        if (x.kind === "serial") {
          if (!known.has(x.expertId)) extra.add(x.expertId);
        } else if (x.kind === "parallel") {
          for (const r of x.steps) if (!known.has(r.expertId)) extra.add(r.expertId);
        } else if (x.kind === "conditional") {
          scan(x.thenSteps);
          if (x.elseSteps) scan(x.elseSteps);
        }
      }
    };
    scan([s]);
    return [...members, ...[...extra].map((id) => ({ id, name: expertName(id) }))];
  }, [members, s, expertName]);

  const expertSelect = (value: string, onChange: (v: string) => void) => (
    <select
      className="w-full rounded-[8px] border border-line bg-card px-[10px] py-[7px] text-[12.5px] outline-none focus:border-accent"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {expertOptions.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-[12px]">
      {graph.kind === "summary" ? (
        <>
          <PanelField label={t("expert.workflow.expertLabel")}>
            {expertSelect((s as { expertId?: string }).expertId ?? "", setSummarizer)}
          </PanelField>
          <div className="text-[11px] leading-[1.6] text-ink-3">
            {t("expert.workflow.summarizerHint")}
          </div>
        </>
      ) : s.kind === "conditional" ? (
        <>
          <PanelField label={t("expert.workflow.conditionLabel")}>
            <ConditionRules
              step={s}
              update={(patch) =>
                updateStep(s.id, (cur) => (cur.kind === "conditional" ? { ...cur, ...patch } : cur))
              }
            />
          </PanelField>
          <BranchEditor
            title={t("expert.workflow.thenBranch")}
            tone="then"
            steps={s.thenSteps}
            parentId={s.id}
            branch="then"
            addStep={addStep}
            removeStep={removeStep}
            expertName={expertName}
          />
          <BranchEditor
            title={t("expert.workflow.elseBranch")}
            tone="else"
            steps={s.elseSteps ?? []}
            parentId={s.id}
            branch="else"
            addStep={addStep}
            removeStep={removeStep}
            expertName={expertName}
          />
        </>
      ) : s.kind === "parallel" ? (
        <PanelField label={t("expert.workflow.parallelTitle")}>
          <div className="space-y-[8px]">
            {s.steps.map((r, ri) => (
              <div key={r.id} className="rounded-[9px] border border-line bg-paper p-[8px]">
                <div className="mb-[6px] text-[10.5px] font-bold text-ink-3">{r.id}</div>
                <div className="mb-[6px]">
                  {expertSelect(r.expertId, (v) =>
                    updateStep(s.id, (cur) =>
                      cur.kind === "parallel"
                        ? {
                            ...cur,
                            steps: cur.steps.map((x, i) => (i === ri ? { ...x, expertId: v } : x)),
                          }
                        : cur,
                    ),
                  )}
                </div>
                <textarea
                  className="w-full rounded-[8px] border border-line bg-card px-[10px] py-[7px] font-mono text-[12px] outline-none focus:border-accent"
                  rows={2}
                  value={r.prompt}
                  onChange={(e) =>
                    updateStep(s.id, (cur) =>
                      cur.kind === "parallel"
                        ? {
                            ...cur,
                            steps: cur.steps.map((x, i) =>
                              i === ri ? { ...x, prompt: e.target.value } : x,
                            ),
                          }
                        : cur,
                    )
                  }
                />
                {s.steps.length > 1 ? (
                  <button
                    type="button"
                    className="mt-[6px] text-[11px] font-semibold text-danger"
                    onClick={() =>
                      updateStep(s.id, (cur) =>
                        cur.kind === "parallel"
                          ? { ...cur, steps: cur.steps.filter((_, i) => i !== ri) }
                          : cur,
                      )
                    }
                  >
                    {t("expert.workflow.removeMember")}
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              className="w-full rounded-full border border-dashed border-line-strong px-[10px] py-[4px] text-[12px] text-ink-3 transition hover:border-accent-line hover:text-accent"
              onClick={() =>
                updateStep(s.id, (cur) =>
                  cur.kind === "parallel"
                    ? {
                        ...cur,
                        steps: [
                          ...cur.steps,
                          {
                            id: `${cur.id}-${cur.steps.length + 1}`,
                            expertId: members[0]?.id ?? "daily",
                            prompt: `你是${expertName(members[0]?.id ?? "daily")}：针对「{user}」完成你的部分。`,
                          },
                        ],
                      }
                    : cur,
                )
              }
            >
              ＋ {t("expert.workflow.addMember")}
            </button>
          </div>
        </PanelField>
      ) : (
        <>
          <PanelField label={t("expert.workflow.expertLabel")}>
            {expertSelect(s.expertId, (v) => updateStep(s.id, (cur) => ({ ...cur, expertId: v })))}
          </PanelField>
          <PanelField label={t("expert.workflow.promptLabel")}>
            <textarea
              className="w-full rounded-[8px] border border-line bg-card px-[10px] py-[7px] font-mono text-[12px] leading-[1.55] outline-none focus:border-accent"
              rows={4}
              value={s.prompt}
              onChange={(e) => updateStep(s.id, (cur) => ({ ...cur, prompt: e.target.value }))}
              placeholder={t("expert.workflow.promptHint")}
            />
          </PanelField>
        </>
      )}

      <div className="flex flex-wrap items-center gap-[6px] border-t border-line pt-[10px]">
        <button
          type="button"
          className="text-[11.5px] font-semibold text-accent"
          onClick={() => duplicateStep(s.id)}
        >
          {t("expert.workflow.duplicateNode")}
        </button>
        {graph.branch === undefined && graph.kind !== "summary" ? (
          <>
            <button
              type="button"
              className="text-[11.5px] font-semibold text-ink-2"
              onClick={() => moveTop(s.id, -1)}
            >
              ↑ {t("expert.workflow.moveUp")}
            </button>
            <button
              type="button"
              className="text-[11.5px] font-semibold text-ink-2"
              onClick={() => moveTop(s.id, 1)}
            >
              ↓ {t("expert.workflow.moveDown")}
            </button>
            <span className="text-ink-3">·</span>
            <button
              type="button"
              className="text-[11.5px] font-semibold text-ink-2"
              onClick={() => addStep("serial")}
            >
              {t("expert.workflow.addAfter")}
            </button>
          </>
        ) : null}
        {graph.kind !== "summary" ? (
          <>
            <span className="flex-1" />
            <button
              type="button"
              className="text-[11.5px] font-semibold text-danger"
              onClick={() => removeStep(s.id)}
            >
              {t("expert.workflow.removeNode")}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function PanelField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-[5px] text-[10.5px] font-bold tracking-[0.04em] text-ink-2">{label}</div>
      {children}
    </div>
  );
}

function ConditionRules({
  step,
  update,
}: {
  step: Extract<WorkflowStep, { kind: "conditional" }>;
  update: (patch: Partial<Extract<WorkflowStep, { kind: "conditional" }>>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="space-y-[7px]">
        {step.rules.map((r, ri) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 条件规则按索引编辑（增/删/改均在原数组位次上），无稳定 id
          <div key={ri} className="flex items-center gap-[6px]">
            <input
              className="w-[92px] rounded-[8px] border border-line bg-card px-[8px] py-[6px] font-mono text-[11px] outline-none focus:border-accent"
              value={`{{${r.var}.result}}`}
              onChange={(e) => {
                const m = e.target.value.match(/\{\{\s*([\w-]+)\s*\.result\s*\}\}/);
                const v = (m ? m[1] : e.target.value.trim()) ?? "";
                update({ rules: step.rules.map((x, i) => (i === ri ? { ...x, var: v } : x)) });
              }}
              title="引用前序步骤输出"
            />
            <select
              className="rounded-[8px] border border-line bg-card px-[6px] py-[6px] text-[11.5px] outline-none focus:border-accent"
              value={r.op}
              onChange={(e) =>
                update({
                  rules: step.rules.map((x, i) =>
                    i === ri ? { ...x, op: e.target.value as WorkflowConditionOp } : x,
                  ),
                })
              }
            >
              {CONDITION_OPS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              className="w-[64px] rounded-[8px] border border-line bg-card px-[8px] py-[6px] text-[11.5px] outline-none focus:border-accent disabled:opacity-40"
              value={r.value ?? ""}
              disabled={r.op === "is_empty" || r.op === "is_not_empty"}
              placeholder="值"
              onChange={(e) =>
                update({
                  rules: step.rules.map((x, i) => (i === ri ? { ...x, value: e.target.value } : x)),
                })
              }
            />
            {step.rules.length > 1 ? (
              <button
                type="button"
                className="text-[11px] font-semibold text-danger"
                onClick={() => update({ rules: step.rules.filter((_, i) => i !== ri) })}
              >
                ✕
              </button>
            ) : null}
          </div>
        ))}
      </div>
      <div className="mt-[8px] flex items-center gap-[6px]">
        {(["and", "or"] as const).map((lg) => (
          <button
            key={lg}
            type="button"
            onClick={() => update({ logic: lg })}
            className={`rounded-full px-[10px] py-[2px] text-[11px] font-bold transition ${
              step.logic === lg
                ? "bg-accent-tint text-accent-strong"
                : "border border-line text-ink-3 hover:text-ink-2"
            }`}
          >
            {lg === "and"
              ? t("expert.workflow.conditionLogicAnd")
              : t("expert.workflow.conditionLogicOr")}
          </button>
        ))}
        <span className="flex-1" />
        <button
          type="button"
          className="text-[11px] font-semibold text-accent"
          onClick={() =>
            update({ rules: [...step.rules, { var: "analysis", op: "contains", value: "" }] })
          }
        >
          ＋ {t("expert.workflow.addRule")}
        </button>
      </div>
    </div>
  );
}

function BranchEditor({
  title,
  tone,
  steps,
  parentId,
  branch,
  addStep,
  removeStep,
  expertName,
}: {
  title: string;
  tone: "then" | "else";
  steps: WorkflowStep[];
  parentId: string;
  branch: "then" | "else";
  addStep: (
    kind: "serial" | "parallel" | "conditional",
    target?: { parentId: string; branch: "then" | "else" },
  ) => void;
  removeStep: (id: string) => void;
  expertName: (id: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={`rounded-[9px] border p-[8px] ${tone === "then" ? "border-accent-line bg-accent-tint" : "border-warn-line bg-warn-tint"}`}
    >
      <div
        className={`mb-[6px] text-[11px] font-bold ${tone === "then" ? "text-accent-strong" : "text-warn"}`}
      >
        {title}
      </div>
      {steps.length === 0 ? (
        <div className="mb-[6px] text-[11px] text-ink-3">{t("expert.workflow.emptyBranch")}</div>
      ) : (
        <div className="mb-[6px] space-y-[5px]">
          {steps.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-[6px] rounded-[7px] bg-card px-[8px] py-[5px] text-[11.5px]"
            >
              <span className="min-w-0 flex-1 truncate">
                <span className="font-mono font-bold text-ink-3">{s.id}</span>
                <span className="text-ink-2">
                  {" "}
                  ·{" "}
                  {s.kind === "parallel"
                    ? s.steps.map((r) => expertName(r.expertId)).join("+")
                    : s.kind === "conditional"
                      ? "条件"
                      : expertName(s.expertId)}
                </span>
              </span>
              <button
                type="button"
                className="text-[11px] font-semibold text-danger"
                onClick={() => removeStep(s.id)}
              >
                {t("expert.workflow.removeNode")}
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-[6px]">
        {(["serial", "parallel", "conditional"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="rounded-full border border-dashed border-line-strong px-[8px] py-[2px] text-[10.5px] text-ink-3 transition hover:border-accent-line hover:text-accent"
            onClick={() => addStep(kind, { parentId, branch })}
          >
            ＋
            {kind === "serial"
              ? t("expert.workflow.addTask")
              : kind === "parallel"
                ? t("expert.workflow.addParallel")
                : t("expert.workflow.addConditional")}
          </button>
        ))}
      </div>
    </div>
  );
}
