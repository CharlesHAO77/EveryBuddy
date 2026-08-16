/**
 * workflowCondition 单元测试：确定性规则求值器（各运算符语义、and/or 组合、边界）。
 */

import type { WorkflowConditionRule } from "@everybuddy/ipc-contract";
import { describe, expect, it } from "vitest";
import { evalRule, evalWorkflowCondition, resolveRuleVar } from "../src/main/runtime/workflowCondition";

const rule = (op: WorkflowConditionRule["op"], value?: string): WorkflowConditionRule => ({
  var: "s1",
  op,
  value,
});

function results(entries: Array<[string, string]>): Map<string, string> {
  return new Map(entries);
}

describe("resolveRuleVar", () => {
  it("剥掉 {{id.result}} 花括号，返回裸 id", () => {
    expect(resolveRuleVar("{{review.result}}")).toBe("review");
    expect(resolveRuleVar("review")).toBe("review");
    expect(resolveRuleVar(" {{ design.result }} ")).toBe("design");
  });
});

describe("evalRule", () => {
  it("contains / not_contains", () => {
    expect(evalRule(rule("contains", "通过"), "评审通过")).toBe(true);
    expect(evalRule(rule("contains", "通过"), "评审失败")).toBe(false);
    expect(evalRule(rule("not_contains", "通过"), "评审失败")).toBe(true);
  });
  it("is_empty / is_not_empty（trim 判断）", () => {
    expect(evalRule(rule("is_empty"), "  ")).toBe(true);
    expect(evalRule(rule("is_empty"), "有内容")).toBe(false);
    expect(evalRule(rule("is_not_empty"), "有内容")).toBe(true);
    expect(evalRule(rule("is_not_empty"), "")).toBe(false);
  });
  it("equals / not_equals / starts_with / ends_with", () => {
    expect(evalRule(rule("equals", "OK"), "OK")).toBe(true);
    expect(evalRule(rule("not_equals", "OK"), "FAIL")).toBe(true);
    expect(evalRule(rule("starts_with", "结论"), "结论：通过")).toBe(true);
    expect(evalRule(rule("ends_with", "通过"), "结论：通过")).toBe(true);
  });
  it("len_gt / len_lt（value 转数字）", () => {
    expect(evalRule(rule("len_gt", "10"), "abcdefghijk")).toBe(true);
    expect(evalRule(rule("len_gt", "10"), "abc")).toBe(false);
    expect(evalRule(rule("len_lt", "5"), "abc")).toBe(true);
    expect(evalRule(rule("len_gt", "abc"), "任何文本")).toBe(false); // 非数字 → false
  });
});

describe("evalWorkflowCondition", () => {
  it("空规则恒真（走 then）", () => {
    expect(evalWorkflowCondition([], "and", results([]))).toBe(true);
    expect(evalWorkflowCondition([], "or", results([]))).toBe(true);
  });
  it("缺失变量视为空串", () => {
    const r: WorkflowConditionRule = { var: "missing", op: "is_empty" };
    expect(evalWorkflowCondition([r], "and", results([]))).toBe(true);
    const r2: WorkflowConditionRule = { var: "missing", op: "contains", value: "x" };
    expect(evalWorkflowCondition([r2], "and", results([]))).toBe(false);
  });
  it("and = 全真", () => {
    const rs = [
      { var: "s1", op: "contains", value: "A" },
      { var: "s2", op: "is_not_empty" },
    ];
    expect(
      evalWorkflowCondition(
        rs,
        "and",
        results([
          ["s1", "AB"],
          ["s2", "有"],
        ]),
      ),
    ).toBe(true);
    expect(
      evalWorkflowCondition(
        rs,
        "and",
        results([
          ["s1", "AB"],
          ["s2", ""],
        ]),
      ),
    ).toBe(false);
  });
  it("or = 任一真", () => {
    const rs = [
      { var: "s1", op: "contains", value: "A" },
      { var: "s2", op: "contains", value: "B" },
    ];
    expect(
      evalWorkflowCondition(
        rs,
        "or",
        results([
          ["s1", "无"],
          ["s2", "含B"],
        ]),
      ),
    ).toBe(true);
    expect(
      evalWorkflowCondition(
        rs,
        "or",
        results([
          ["s1", "无"],
          ["s2", "无"],
        ]),
      ),
    ).toBe(false);
  });
  it("{{id.result}} 花括号写法同样解析", () => {
    const r: WorkflowConditionRule = { var: "{{review.result}}", op: "contains", value: "通过" };
    expect(evalWorkflowCondition([r], "and", results([["review", "评审通过"]]))).toBe(true);
  });
});
