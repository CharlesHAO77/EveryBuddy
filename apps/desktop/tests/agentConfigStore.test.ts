/**
 * agentConfigStore 单元测试——可注入路径，不触碰真实 ~/EveryBuddy。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AgentConfig,
  type AgentConfigPaths,
  getAgentConfig,
  saveAgentConfig,
} from "../src/main/stores/agentConfigStore";

let tmpDir: string;
let paths: AgentConfigPaths;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(tmpdir(), "eb-agentconfig-"));
  paths = {
    office: path.join(tmpDir, "agent-office.json"),
    coding: path.join(tmpDir, "agent-coding.json"),
  };
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("getAgentConfig / saveAgentConfig", () => {
  it("缺文件 → 空配置（不抛错）", () => {
    expect(getAgentConfig("daily", paths)).toEqual({});
    expect(getAgentConfig("coding", paths)).toEqual({});
  });

  it("save → get 往返，mode 落到各自文件", () => {
    const office: AgentConfig = {
      systemPrompt: "你是办公助手",
      tools: ["understand_image", "generate_image"],
      defaultModelProviderId: "v1",
      visionModelProviderId: "v1",
      imageGenModelProviderId: "g1",
    };
    saveAgentConfig("daily", office, paths);
    expect(getAgentConfig("daily", paths)).toEqual(office);

    // coding 不受影响（文件未创建）
    expect(getAgentConfig("coding", paths)).toEqual({});
    expect(readFileSync(paths.office, "utf-8")).toContain("你是办公助手");
    expect(existsSync(paths.coding)).toBe(false);
  });

  it("两个模式独立读写", () => {
    saveAgentConfig("daily", { systemPrompt: "A" }, paths);
    saveAgentConfig("coding", { systemPrompt: "B", tools: ["bash"] }, paths);
    expect(getAgentConfig("daily", paths)).toEqual({ systemPrompt: "A" });
    expect(getAgentConfig("coding", paths)).toEqual({ systemPrompt: "B", tools: ["bash"] });
  });

  it("损坏 JSON → 空配置", () => {
    writeFileSync(paths.office, "not json {", "utf-8");
    expect(getAgentConfig("daily", paths)).toEqual({});
  });

  it("保存后覆盖旧值", () => {
    saveAgentConfig("daily", { systemPrompt: "旧" }, paths);
    saveAgentConfig("daily", { systemPrompt: "新", tools: ["understand_image"] }, paths);
    expect(getAgentConfig("daily", paths)).toEqual({
      systemPrompt: "新",
      tools: ["understand_image"],
    });
  });
});
