/**
 * 系统提示词 builder 单元测试 -- 验证按模式 + 激活工具动态拼装。
 */
import { describe, expect, it } from "vitest";
import {
  buildActiveToolsBlock,
  getModeSystemPrompt,
  TOOL_SNIPPETS,
} from "../src/main/prompts/index";

describe("getModeSystemPrompt", () => {
  it("daily 模式产出办公助理角色与工具清单", () => {
    const prompt = getModeSystemPrompt("daily", {
      activeTools: ["read", "parse_attachment", "understand_image"],
    });
    expect(prompt).toContain("办公助理");
    expect(prompt).toContain("- read:");
    expect(prompt).toContain("- parse_attachment:");
    expect(prompt).toContain("- understand_image:");
  });

  it("coding 模式产出编码助手角色", () => {
    const prompt = getModeSystemPrompt("coding", { activeTools: ["read", "edit"] });
    expect(prompt).toContain("编码助手");
    expect(prompt).toContain("- edit:");
  });

  it("仅列出 TOOL_SNIPPETS 中存在的工具，未知工具被过滤", () => {
    const prompt = getModeSystemPrompt("coding", {
      activeTools: ["read", "some-unknown-tool", "bash"],
    });
    expect(prompt).toContain("- read:");
    expect(prompt).toContain("- bash:");
    expect(prompt).not.toContain("some-unknown-tool");
  });

  it("activeTools 为空时显示 (无)", () => {
    const prompt = getModeSystemPrompt("daily", { activeTools: [] });
    expect(prompt).toContain("(无)");
  });

  it("TOOL_SNIPPETS 包含 todo 条目", () => {
    expect(TOOL_SNIPPETS.todo).toBeTruthy();
  });
});

describe("buildActiveToolsBlock", () => {
  it("列出激活工具 + 显式「未列出不可用」约束", () => {
    const block = buildActiveToolsBlock(["parse_attachment"]);
    expect(block).toContain("parse_attachment");
    expect(block).toContain("未列出的一律不可用");
  });

  it("无工具时输出 (无工具)", () => {
    expect(buildActiveToolsBlock([])).toContain("(无工具)");
  });
});
