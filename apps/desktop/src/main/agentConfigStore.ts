/**
 * agentConfigStore - 办公 / 编码 agent 配置分离（见 agent-office.json / agent-coding.json）。
 *
 * 与 configStore / modelStore 同一模式：JSON 文件落盘 + 可注入路径（单测用临时目录）。
 * 每个模式一份独立配置，决定 createAgentSession 的 system prompt、工具 allowlist、
 * 默认/视觉/生图模型。不含密钥（密钥仍在 auth.json）。
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentMode } from "@everybuddy/ipc-contract";
import { APP_ROOT } from "./configStore";

/** agent 配置文件落盘目录 ~/EveryBuddy */
export interface AgentConfigPaths {
  office: string;
  coding: string;
}

export const AGENT_OFFICE_PATH = path.join(APP_ROOT, "agent-office.json");
export const AGENT_CODING_PATH = path.join(APP_ROOT, "agent-coding.json");

const DEFAULT_PATHS: AgentConfigPaths = {
  office: AGENT_OFFICE_PATH,
  coding: AGENT_CODING_PATH,
};

/** 单模式 agent 配置（可编辑字段） */
export interface AgentConfig {
  /** 覆盖默认 system prompt */
  systemPrompt?: string;
  /** 追加到 system prompt 末尾的文本 */
  appendSystemPrompt?: string[];
  /** 追加到工具 allowlist 的工具名（如 ["understand_image","generate_image"]） */
  tools?: string[];
  /** 该模式的默认对话模型 provider id */
  defaultModelProviderId?: string;
  /** 该模式的视觉理解模型 provider id（缺省用能力标签） */
  visionModelProviderId?: string;
  /** 该模式的生图模型 provider id（缺省用能力标签） */
  imageGenModelProviderId?: string;
}

function pathForMode(mode: AgentMode, paths: AgentConfigPaths): string {
  return mode === "coding" ? paths.coding : paths.office;
}

/** 读取某模式配置；文件缺失/损坏 → 空配置（不抛错） */
export function getAgentConfig(
  mode: AgentMode,
  paths: AgentConfigPaths = DEFAULT_PATHS,
): AgentConfig {
  const file = pathForMode(mode, paths);
  try {
    const parsed = JSON.parse(readFileSync(file, "utf-8")) as AgentConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** 保存某模式配置（原子性不关键，配置低敏） */
export function saveAgentConfig(
  mode: AgentMode,
  cfg: AgentConfig,
  paths: AgentConfigPaths = DEFAULT_PATHS,
): void {
  const file = pathForMode(mode, paths);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(cfg, null, 2), "utf-8");
}
