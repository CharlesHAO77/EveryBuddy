/**
 * toolAllowlist 单元测试——回归防护：
 * SDK 会用 createAgentSession 的 tools allowlist 过滤 customTools，视觉理解/生图工具
 * 若只注册不入 allowlist，模型就看不到（历史 bug：generate_image 注册了但 Agent 不列）。
 */
import { describe, expect, it } from "vitest";
import {
  buildToolAllowlist,
  CUSTOM_TOOL_NAMES,
} from "../src/main/tools/toolAllowlist";

describe("buildToolAllowlist", () => {
  it("始终包含视觉理解/生图自定义工具（含 agent 配置为空时）", () => {
    const allowlist = buildToolAllowlist(["read", "write", "bash", "grep"], undefined);
    for (const name of CUSTOM_TOOL_NAMES) {
      expect(allowlist).toContain(name);
    }
  });

  it("平台工具 + agent 配置 tools + 恒注册工具去重保序", () => {
    const allowlist = buildToolAllowlist(
      ["read", "bash", "grep", "understand_image"],
      ["grep", "my_tool"],
    );
    expect(allowlist).toEqual([
      "read",
      "bash",
      "grep",
      "understand_image",
      "my_tool",
      "generate_image",
    ]);
  });
});
