/**
 * plan-mode utils 单元测试 -- 纯函数，无 SDK 依赖。
 * 重点覆盖计划步骤提取与 [DONE:n] 完成标记追踪的核心逻辑。
 */
import { describe, expect, it } from "vitest";
import {
  cleanStepText,
  extractDoneSteps,
  extractTodoItems,
  isSafeCommand,
  markCompletedSteps,
} from "../src/main/extensions/plan-mode/utils";

describe("isSafeCommand", () => {
  it("放行只读命令", () => {
    expect(isSafeCommand("ls -la")).toBe(true);
    expect(isSafeCommand("cat src/index.ts")).toBe(true);
    expect(isSafeCommand("git status")).toBe(true);
    expect(isSafeCommand("grep -r foo .")).toBe(true);
  });

  it("拦截破坏性命令", () => {
    expect(isSafeCommand("rm -rf dist")).toBe(false);
    expect(isSafeCommand("git commit -m x")).toBe(false);
    expect(isSafeCommand("npm install")).toBe(false);
    expect(isSafeCommand("echo x > file.txt")).toBe(false);
    expect(isSafeCommand("sudo rm /etc/passwd")).toBe(false);
  });

  it("未命中安全白名单的命令视为不安全", () => {
    expect(isSafeCommand("some-unknown-cmd")).toBe(false);
  });
});

describe("extractTodoItems", () => {
  it("从 Plan: 段落提取编号步骤（步骤文本须 > 5 字符）", () => {
    const msg = `我来分析一下。

Plan:
1. 读取项目配置文件
2. 修改入口模块代码
3. 运行测试用例验证`;
    const items = extractTodoItems(msg);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({ step: 1, text: "读取项目配置文件", completed: false });
    expect(items[2]?.step).toBe(3);
  });

  it("无 Plan: 头时返回空", () => {
    expect(extractTodoItems("1. something here\n2. another thing")).toEqual([]);
  });

  it("过短的步骤文本被过滤（length <= 5）", () => {
    const msg = `Plan:\n1. short\n2. 这是一个较长的步骤`;
    const items = extractTodoItems(msg);
    expect(items).toHaveLength(1);
    expect(items[0]?.text).toBe("这是一个较长的步骤");
  });
});

describe("extractDoneSteps / markCompletedSteps", () => {
  it("提取 [DONE:n] 标记", () => {
    expect(extractDoneSteps("step done [DONE:2]")).toEqual([2]);
    expect(extractDoneSteps("[DONE:1] and [DONE:3]")).toEqual([1, 3]);
    expect(extractDoneSteps("nothing here")).toEqual([]);
  });

  it("markCompletedSteps 标记对应步骤完成", () => {
    const items = extractTodoItems(
      `Plan:\n1. 第一个步骤描述\n2. 第二个步骤描述\n3. 第三个步骤描述`,
    );
    expect(items).toHaveLength(3);
    const count = markCompletedSteps("done with first [DONE:1]", items);
    expect(count).toBe(1);
    expect(items[0]?.completed).toBe(true);
    expect(items[1]?.completed).toBe(false);
    expect(items[2]?.completed).toBe(false);
  });
});

describe("cleanStepText", () => {
  it("去除前导动词与多余空白（无前导空格时生效）", () => {
    expect(cleanStepText("Run the tests")).toBe("Tests");
    expect(cleanStepText("create module")).toBe("Module");
  });

  it("去除加粗/代码包裹", () => {
    expect(cleanStepText("**Run** the tests")).toBe("Tests");
    expect(cleanStepText("Check `config` file")).toBe("Config file");
  });

  it("截断超长文本", () => {
    const long = "x".repeat(80);
    expect(cleanStepText(long).length).toBeLessThanOrEqual(50);
  });
});
