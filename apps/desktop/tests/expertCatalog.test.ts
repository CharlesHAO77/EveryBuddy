/**
 * expertCatalog - 专家表单目录（平台工具 + 扩展 + 模式默认提示词）单元测试。
 */
import { describe, expect, it } from "vitest";
import { buildExpertCatalog } from "../src/main/services/expertCatalog";

describe("buildExpertCatalog", () => {
  it("tools 含平台工具，extensions 含 permission（恒启用）", () => {
    const c = buildExpertCatalog();
    const names = c.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["read", "bash", "edit", "write", "grep", "find"]));
    expect(names).toContain("understand_image");
    const ext = c.extensions.find((x) => x.name === "permission");
    expect(ext?.alwaysOn).toBe(true);
    expect(c.extensions.map((x) => x.name)).toEqual(
      expect.arrayContaining(["plan-mode", "todo", "permission"]),
    );
  });

  it("modePrompts 为各模式生成非空默认提示词", () => {
    const c = buildExpertCatalog();
    expect(c.modePrompts.daily).toBeTruthy();
    expect(c.modePrompts.coding).toBeTruthy();
    expect(c.modePrompts.coding).toContain("编码助手");
    expect(c.modePrompts.daily).toContain("办公助理");
  });

  it("defaultTools / defaultExtensions 覆盖平台工具与默认扩展（内置专家自动勾选）", () => {
    const c = buildExpertCatalog();
    for (const mode of ["daily", "coding"] as const) {
      expect(c.defaultTools[mode]).toEqual(expect.arrayContaining(["read", "bash", "edit"]));
      expect(c.defaultExtensions[mode]).toEqual(["plan-mode", "todo"]);
    }
  });
});
