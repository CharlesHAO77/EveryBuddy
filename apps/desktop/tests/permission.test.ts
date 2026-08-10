/**
 * 工具权限扩展单元测试 -- 用假 emit / 假 pi 验证 tool_call 门禁。
 */
import { describe, expect, it } from "vitest";
import { createPermissionExtension, shouldPromptForTool } from "../src/main/extensions/permission";

/** 假 ExtensionAPI：仅捕获 on() 注册的 handler */
function makePi() {
  const handlers = new Map<string, (event: unknown, ctx?: unknown) => unknown>();
  return {
    on: (evt: string, handler: (event: unknown, ctx?: unknown) => unknown) =>
      handlers.set(evt, handler),
    getHandler: (evt: string) => handlers.get(evt),
  };
}

/** ExtensionHandle.controller 为 unknown，测试内按实际形状断言 */
type TestPermissionController = {
  resolve: (requestId: string, approved: boolean) => void;
  dispose: () => void;
};

describe("shouldPromptForTool", () => {
  it("副作用工具需提示", () => {
    expect(shouldPromptForTool("bash")).toBe(true);
    expect(shouldPromptForTool("edit")).toBe(true);
    expect(shouldPromptForTool("write")).toBe(true);
    expect(shouldPromptForTool("generate_image")).toBe(true);
  });

  it("只读/无副作用工具自动放行", () => {
    for (const name of [
      "read",
      "grep",
      "find",
      "ls",
      "parse_attachment",
      "understand_image",
      "todo",
    ]) {
      expect(shouldPromptForTool(name)).toBe(false);
    }
  });
});

describe("createPermissionExtension", () => {
  it("manual + 副作用工具：emit tool_approval_required 并等待应答（拒绝→block）", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const pi = makePi();
    const { factory, controller } = createPermissionExtension(
      (evt) => emitted.push(evt as never),
      () => "manual",
    );
    const ctrl = controller as TestPermissionController;
    factory(pi as never);

    const handler = pi.getHandler("tool_call") as (e: unknown) => Promise<unknown>;
    const p = handler({ toolName: "bash", toolCallId: "c1", input: { command: "rm -rf dist" } });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe("tool_approval_required");
    const payload = emitted[0]?.payload ?? {};
    expect(payload.toolName).toBe("bash");
    expect(payload.isDangerous).toBe(true);

    ctrl.resolve(String(payload.requestId), false);
    expect(await p).toEqual({ block: true, reason: "用户拒绝执行" });
  });

  it("manual + 副作用工具：允许则放行", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const pi = makePi();
    const { factory, controller } = createPermissionExtension(
      (evt) => emitted.push(evt as never),
      () => "manual",
    );
    const ctrl = controller as TestPermissionController;
    factory(pi as never);

    const handler = pi.getHandler("tool_call") as (e: unknown) => Promise<unknown>;
    const p = handler({
      toolName: "edit",
      toolCallId: "c2",
      input: { file: "a.ts", oldString: "x", newString: "y" },
    });
    const requestId = String(emitted[0]?.payload.requestId);
    ctrl.resolve(requestId, true);
    expect(await p).toBeUndefined();
  });

  it("auto 模式不 emit 直接放行", async () => {
    const emitted: Array<{ type: string }> = [];
    const pi = makePi();
    const { factory } = createPermissionExtension(
      (evt) => emitted.push(evt),
      () => "auto",
    );
    factory(pi as never);

    const handler = pi.getHandler("tool_call") as (e: unknown) => Promise<unknown>;
    const result = await handler({ toolName: "bash", toolCallId: "c3", input: {} });
    expect(result).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });

  it("manual + 只读工具也直接放行", async () => {
    const emitted: Array<{ type: string }> = [];
    const pi = makePi();
    const { factory } = createPermissionExtension(
      (evt) => emitted.push(evt),
      () => "manual",
    );
    factory(pi as never);

    const handler = pi.getHandler("tool_call") as (e: unknown) => Promise<unknown>;
    const result = await handler({ toolName: "read", toolCallId: "c4", input: { file: "a.ts" } });
    expect(result).toBeUndefined();
    expect(emitted).toHaveLength(0);
  });

  it("dispose 把未应答请求按拒绝处理，避免工具永久阻塞", async () => {
    const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
    const pi = makePi();
    const { factory, controller } = createPermissionExtension(
      (evt) => emitted.push(evt as never),
      () => "manual",
    );
    const ctrl = controller as TestPermissionController;
    factory(pi as never);

    const handler = pi.getHandler("tool_call") as (e: unknown) => Promise<unknown>;
    const p = handler({ toolName: "bash", toolCallId: "c5", input: {} });
    ctrl.dispose();
    expect(await p).toEqual({ block: true, reason: "用户拒绝执行" });
  });
});
