/**
 * 桌面适配扩展共享类型。
 *
 * pi 扩展原为 TUI 设计（ctx.ui.* / registerShortcut / Key 等），桌面端 React UI 不跑 TUI，
 * 故扩展行为钩子（pi.on / registerTool / setActiveTools / appendEntry）原样保留，
 * UI 反馈改为经 Emit 推送 AgentEvent 到渲染进程；触发入口改为控制器（侧信道）。
 */

import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@everybuddy/ipc-contract";

/** 去掉 streamId 的事件（agentRuntime 注入时补上 task.streamId） */
type WithoutStreamId<T> = T extends { streamId: string } ? Omit<T, "streamId"> : T;

/** 扩展向渲染进程推送事件（由 agentRuntime 创建工厂时注入） */
export type Emit = (evt: WithoutStreamId<AgentEvent>) => void;

/** 扩展注册产物 */
export interface ExtensionHandle {
  /** pi 扩展工厂（传入 DefaultResourceLoader.extensionFactories） */
  factory: ExtensionFactory;
  /** 扩展注册的工具名（并入 tools allowlist 让模型可用） */
  tools?: string[];
  /** 侧信道控制器（ipcRouter -> agentRuntime -> controller，供渲染进程按钮触发） */
  controller?: unknown;
}
