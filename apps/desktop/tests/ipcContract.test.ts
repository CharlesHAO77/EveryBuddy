/**
 * ipc-contract 新增 schema 单元测试：执行模式与工具审批请求校验。
 */

import { approveToolRequestSchema, setModeRequestSchema } from "@everybuddy/ipc-contract";
import { describe, expect, it } from "vitest";

describe("setModeRequestSchema", () => {
  it("接受合法 mode", () => {
    for (const mode of ["auto", "manual", "plan"]) {
      expect(setModeRequestSchema.parse({ taskId: "t1", mode }).mode).toBe(mode);
    }
  });

  it("拒绝非法 mode / 缺字段", () => {
    expect(() => setModeRequestSchema.parse({ taskId: "t1", mode: "coding" })).toThrow();
    expect(() => setModeRequestSchema.parse({ taskId: "t1" })).toThrow();
    expect(() => setModeRequestSchema.parse({ mode: "auto" })).toThrow();
  });
});

describe("approveToolRequestSchema", () => {
  it("接受合法请求", () => {
    const parsed = approveToolRequestSchema.parse({
      taskId: "t1",
      requestId: "r1",
      approved: true,
    });
    expect(parsed.approved).toBe(true);
  });

  it("拒绝缺字段 / 非布尔 approved", () => {
    expect(() => approveToolRequestSchema.parse({ taskId: "t1", requestId: "r1" })).toThrow();
    expect(() => approveToolRequestSchema.parse({ taskId: "t1", approved: true })).toThrow();
    expect(() =>
      approveToolRequestSchema.parse({ taskId: "t1", requestId: "r1", approved: "yes" }),
    ).toThrow();
  });
});
