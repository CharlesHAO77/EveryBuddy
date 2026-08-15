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
import type { AgentMode, ExpertCatalogExtension } from "@everybuddy/ipc-contract";
import { createPermissionExtension } from "./permission";
import { createPlanModeExtension } from "./plan-mode/index";
import { createTodoExtension } from "./todo";
import type { Emit, ExtensionDeps, ExtensionHandle } from "./types";

export const EXTENSION_REGISTRY: Record<
  string,
  (emit: Emit, deps: ExtensionDeps) => ExtensionHandle
> = {
  "plan-mode": (emit) => createPlanModeExtension(emit),
  todo: (emit) => createTodoExtension(emit),
  permission: (emit, deps) => createPermissionExtension(emit, deps.getMode ?? (() => "auto")),
};

/** 扩展目录（专家表单列表选择用）；permission 由 buildExtensionFactories 恒注入，标 alwaysOn */
export const EXTENSION_CATALOG: ExpertCatalogExtension[] = [
  { name: "plan-mode", description: "计划模式：只读探索 + 计划执行" },
  { name: "todo", description: "待办列表管理（list/add/toggle/clear）" },
  { name: "permission", description: "工具权限门禁（副作用工具确认）", alwaysOn: true },
];

/** 各模式默认加载的扩展（agent-*.json 未配 extensions 时使用；permission 恒在 buildExtensionFactories 强制加入） */
export const DEFAULT_EXTENSIONS: Record<AgentMode, string[]> = {
  daily: ["plan-mode", "todo"],
  coding: ["plan-mode", "todo"],
};

export function buildExtensionFactories(
  names: string[],
  emit: Emit,
  deps: ExtensionDeps = {},
  opts: { includePermission?: boolean } = {},
) {
  const factories: InlineExtension[] = [];
  const controllers: Record<string, unknown> = {};
  const tools: string[] = [];
  // 权限扩展恒在（不随 agent-*.json extensions 关闭），作为工具调用门禁；
  // headless 子会话传 includePermission:false 跳过（委派已获授权，不再逐工具弹窗）
  const effective = Array.from(
    new Set([...(opts.includePermission !== false ? ["permission"] : []), ...names]),
  );
  for (const name of effective) {
    const handle = EXTENSION_REGISTRY[name]?.(emit, deps);
    if (!handle) continue;
    factories.push(handle.factory);
    if (handle.controller) controllers[name] = handle.controller;
    if (handle.tools) tools.push(...handle.tools);
  }
  return { factories, controllers, tools };
}
