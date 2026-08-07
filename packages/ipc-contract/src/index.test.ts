/**
 * IPC 契约 Zod schema 单元测试（见 AGENTS.md §7.2）。
 * 锁住主进程对渲染进程输入的校验行为——任何未来的 IPC 消费者（主进程、IM Bot、WebUI）都依赖这些 schema。
 */
import { describe, expect, it } from "vitest";
import {
  createNamedWorkspaceRequestSchema,
  createTaskRequestSchema,
  createWorkspaceRequestSchema,
  idRequestSchema,
  openPathRequestSchema,
  promptRequestSchema,
  renameTaskRequestSchema,
} from "./index";

describe("renameTaskRequestSchema", () => {
  it("accepts id + title", () => {
    expect(renameTaskRequestSchema.safeParse({ id: "a", title: "t" }).success).toBe(true);
  });
  it("rejects empty title (parity with old !parsed.title check)", () => {
    expect(renameTaskRequestSchema.safeParse({ id: "a", title: "" }).success).toBe(false);
  });
  it("rejects missing id", () => {
    expect(renameTaskRequestSchema.safeParse({ title: "t" }).success).toBe(false);
  });
  it("rejects non-string title", () => {
    expect(renameTaskRequestSchema.safeParse({ id: "a", title: 123 }).success).toBe(false);
  });
});

describe("createWorkspaceRequestSchema", () => {
  it("accepts name + dirPath", () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: "n", dirPath: "/tmp/x" }).success).toBe(
      true,
    );
  });
  it("rejects empty name", () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: "", dirPath: "/tmp/x" }).success).toBe(
      false,
    );
  });
  it("rejects missing dirPath", () => {
    expect(createWorkspaceRequestSchema.safeParse({ name: "n" }).success).toBe(false);
  });
});

describe("createNamedWorkspaceRequestSchema", () => {
  it("accepts name", () => {
    expect(createNamedWorkspaceRequestSchema.safeParse({ name: "n" }).success).toBe(true);
  });
  it("rejects empty name", () => {
    expect(createNamedWorkspaceRequestSchema.safeParse({ name: "" }).success).toBe(false);
  });
  it("rejects missing name", () => {
    expect(createNamedWorkspaceRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("openPathRequestSchema", () => {
  it("accepts path", () => {
    expect(openPathRequestSchema.safeParse({ path: "/tmp/x" }).success).toBe(true);
  });
  it("rejects empty path", () => {
    expect(openPathRequestSchema.safeParse({ path: "" }).success).toBe(false);
  });
  it("rejects missing path", () => {
    expect(openPathRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("回归：既有 schema", () => {
  it("idRequestSchema accepts non-empty id", () => {
    expect(idRequestSchema.safeParse({ id: "a" }).success).toBe(true);
  });
  it("idRequestSchema rejects empty id", () => {
    expect(idRequestSchema.safeParse({ id: "" }).success).toBe(false);
  });
  it("createTaskRequestSchema accepts temp task", () => {
    expect(createTaskRequestSchema.safeParse({ type: "temp" }).success).toBe(true);
  });
  it("createTaskRequestSchema rejects invalid type", () => {
    expect(createTaskRequestSchema.safeParse({ type: "bogus" }).success).toBe(false);
  });
  it("promptRequestSchema accepts sessionId + text", () => {
    expect(promptRequestSchema.safeParse({ sessionId: "a", text: "hi" }).success).toBe(true);
  });
  it("promptRequestSchema rejects empty text", () => {
    expect(promptRequestSchema.safeParse({ sessionId: "a", text: "" }).success).toBe(false);
  });
});
