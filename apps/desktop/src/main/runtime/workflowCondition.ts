/**
 * workflowCondition - 条件节点确定性求值器（本地字符串判断，零 token）。
 *
 * 对齐 Dify/Coze/n8n 主流做法：条件 = 结构化规则（引用前序步骤输出 + 运算符 + 值），
 * 多规则用 and/or 组合。纯函数、可单测，被 teamRuntime.runStep 的条件分支消费。
 */

import type { WorkflowConditionRule } from "@everybuddy/ipc-contract";

/** 引用变量解析：`{{stepId.result}}` 或裸 stepId → stepId */
export function resolveRuleVar(varRef: string): string {
  const m = varRef.match(/\{\{\s*([\w-]+)\s*\.result\s*\}\}/);
  return (m?.[1] ?? varRef).trim();
}

/** 单条规则求值：输出文本（缺失视为空串）+ 规则 */
export function evalRule(rule: WorkflowConditionRule, output: string): boolean {
  const text = output ?? "";
  const v = rule.value ?? "";
  switch (rule.op) {
    case "contains":
      return text.includes(v);
    case "not_contains":
      return !text.includes(v);
    case "is_empty":
      return text.trim().length === 0;
    case "is_not_empty":
      return text.trim().length > 0;
    case "equals":
      return text === v;
    case "not_equals":
      return text !== v;
    case "starts_with":
      return text.startsWith(v);
    case "ends_with":
      return text.endsWith(v);
    case "len_gt": {
      const n = Number(v);
      return Number.isFinite(n) && text.length > n;
    }
    case "len_lt": {
      const n = Number(v);
      return Number.isFinite(n) && text.length < n;
    }
    default:
      return false;
  }
}

/**
 * 条件求值：rules 空 → 恒真（走 then）；and 全真 / or 任一真。
 * results：步骤 id -> 输出全文；缺失变量视为空串。
 */
export function evalWorkflowCondition(
  rules: WorkflowConditionRule[],
  logic: "and" | "or",
  results: Map<string, string>,
): boolean {
  if (!rules || rules.length === 0) return true;
  const verdicts = rules.map((r) => evalRule(r, results.get(resolveRuleVar(r.var)) ?? ""));
  return logic === "or" ? verdicts.some(Boolean) : verdicts.every(Boolean);
}
