/**
 * 扩展注册表 + 工厂构建器。
 *
 * 各 AgentConfig.extensions 声明要加载的扩展名（如 ["plan-mode","todo"]），
 * agentRuntime 调用 buildExtensionFactories 得到 { factories, controllers, tools }：
 *  - factories -> DefaultResourceLoader.extensionFactories（由 SDK 激活）
 *  - controllers -> 存入 session 表，供 ipcRouter:agent:extension-command 触发
 *  - tools -> 并入 tools allowlist（扩展注册的工具默认会被 allowlist 过滤掉）
 */

import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { AgentMode } from "@everybuddy/ipc-contract";
import { createPlanModeExtension } from "./plan-mode/index";
import { createTodoExtension } from "./todo";
import type { Emit, ExtensionHandle } from "./types";

export const EXTENSION_REGISTRY: Record<string, (emit: Emit) => ExtensionHandle> = {
  "plan-mode": (emit) => createPlanModeExtension(emit),
  todo: (emit) => createTodoExtension(emit),
};

/** 各模式默认加载的扩展（agent-*.json 未配 extensions 时使用） */
export const DEFAULT_EXTENSIONS: Record<AgentMode, string[]> = {
  daily: ["todo"],
  coding: ["plan-mode", "todo"],
};

export function buildExtensionFactories(names: string[], emit: Emit) {
  const factories: InlineExtension[] = [];
  const controllers: Record<string, unknown> = {};
  const tools: string[] = [];
  for (const name of names) {
    const handle = EXTENSION_REGISTRY[name]?.(emit);
    if (!handle) continue;
    factories.push(handle.factory);
    if (handle.controller) controllers[name] = handle.controller;
    if (handle.tools) tools.push(...handle.tools);
  }
  return { factories, controllers, tools };
}
