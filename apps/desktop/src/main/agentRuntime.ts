/**
 * AgentRuntime - pi-coding-agent 运行时封装层（见 docs/architecture.md §5.1, §0.4）。
 *
 * 职责：
 *  1. 动态加载 @earendil-works/pi-coding-agent（ESM，运行时 import()）
 *  2. 管理 ModelRuntime（~/EveryBuddy 下的 models.json + auth）
 *  3. 为每个任务创建 AgentSession（SessionManager 落盘到对应目录）
 *  4. 将 pi 内容块粒度事件归一化为 AgentEvent，回调推送给 ipcRouter 广播
 *
 * 事件映射见 §0.4 / §3.2。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentEvent, ModelProviderConfig, TaskMeta } from "@everybuddy/ipc-contract";
import { APP_ROOT, configStore } from "./configStore";
import { getTaskCwd } from "./workspaceManager";

// 类型导入（编译期擦除）；运行时通过动态 import() 加载 ESM 包
type CodingAgentSDK = typeof import("@earendil-works/pi-coding-agent");

type AgentSession = (CodingAgentSDK["AgentSession"] extends new (
  ...args: never[]
) => infer T
  ? T
  : never) & {
  /** SDK AgentSession 支持运行时切换模型 */
  setModel?: (model: PiModel) => Promise<void> | void;
};
type ModelRuntime = Awaited<ReturnType<CodingAgentSDK["ModelRuntime"]["create"]>>;
type SessionManagerInstance = ReturnType<CodingAgentSDK["SessionManager"]["create"]>;
type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;

/** 分布式 Omit，保留判别联合各成员的形状 */
type WithoutStreamId<T> = T extends { streamId: string } ? Omit<T, "streamId"> : T;

const MODELS_JSON_PATH = path.join(APP_ROOT, "models.json");
const AUTH_PATH = path.join(APP_ROOT, "auth.json");

interface RuntimeState {
  session: AgentSession;
  unsubscribe: () => void;
}

class AgentRuntime {
  private sdk: CodingAgentSDK | null = null;
  private modelRuntime: ModelRuntime | null = null;
  private sessions = new Map<string, RuntimeState>();
  /** 事件输出回调（由 ipcRouter 注入，广播到渲染进程） */
  private emitter: ((event: AgentEvent) => void) | null = null;

  setEmitter(fn: (event: AgentEvent) => void): void {
    this.emitter = fn;
  }

  /** 向渲染进程推送错误事件（供 ipcRouter 在会话初始化失败时调用） */
  emitError(streamId: string, message: string): void {
    this.emit(streamId, { type: "error", payload: { message } });
  }

  /** 动态加载 ESM 包 */
  private async load(): Promise<CodingAgentSDK> {
    if (this.sdk) return this.sdk;
    const sdk = await import("@earendil-works/pi-coding-agent");
    this.sdk = sdk;
    return sdk;
  }

  /** 初始化 ModelRuntime，写入 models.json，注入 apiKey */
  async init(): Promise<void> {
    const sdk = await this.load();
    this.syncModelsJson();
    this.modelRuntime = await sdk.ModelRuntime.create({
      authPath: AUTH_PATH,
      modelsPath: MODELS_JSON_PATH,
      allowModelNetwork: false,
    });
    // 为每个已配置 apiKey 的 provider 注入密钥
    for (const m of configStore.getModels()) {
      const stored = configStore.getStoredModel(m.id);
      if (stored?.apiKey) {
        try {
          await this.modelRuntime.setRuntimeApiKey(m.id, stored.apiKey);
        } catch (err) {
          console.error(`[agentRuntime] setRuntimeApiKey(${m.id}) 失败:`, err);
        }
      }
    }
  }

  /** 将 configStore 中的模型配置同步到 ~/EveryBuddy/models.json */
  private syncModelsJson(): void {
    if (!existsSync(APP_ROOT)) mkdirSync(APP_ROOT, { recursive: true });
    const models = configStore.getModels();
    const providers: Record<string, unknown> = {};
    for (const m of models) {
      const stored = configStore.getStoredModel(m.id);
      providers[m.id] = {
        name: m.name,
        baseUrl: m.baseUrl,
        api: "openai-completions",
        apiKey: "placeholder",
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
        },
        models: [{ id: stored?.model ?? m.model }],
      };
    }
    const content = JSON.stringify({ providers }, null, 2);
    writeFileSync(MODELS_JSON_PATH, content, "utf-8");
  }

  /** 新增/更新模型后刷新 runtime */
  async refreshModel(providerId: string, apiKey?: string): Promise<void> {
    if (!this.modelRuntime) await this.init();
    this.syncModelsJson();
    // 重建 runtime 以重新加载 models.json
    const sdk = await this.load();
    this.modelRuntime = await sdk.ModelRuntime.create({
      authPath: AUTH_PATH,
      modelsPath: MODELS_JSON_PATH,
      allowModelNetwork: false,
    });
    if (apiKey) {
      await this.modelRuntime?.setRuntimeApiKey(providerId, apiKey);
    } else {
      const stored = configStore.getStoredModel(providerId);
      if (stored?.apiKey) {
        await this.modelRuntime?.setRuntimeApiKey(providerId, stored.apiKey);
      }
    }
  }

  /** 解析模型对象 */
  private resolveModel(providerId: string): PiModel | undefined {
    if (!this.modelRuntime) return undefined;
    const stored = configStore.getStoredModel(providerId);
    if (!stored) return undefined;
    return this.modelRuntime.getModel(providerId, stored.model) as PiModel | undefined;
  }

  /** 为任务创建/恢复 AgentSession */
  async createTaskSession(task: TaskMeta, providerId?: string): Promise<void> {
    const sdk = await this.load();
    if (!this.modelRuntime) await this.init();

    const cwd = getTaskCwd(task);
    const sessionDir = task.sessionDir;
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

    // 恢复已有会话或新建
    const recentFile = (
      sdk as unknown as {
        findMostRecentSession?: (dir: string) => string | null;
      }
    ).findMostRecentSession?.(sessionDir);
    let sessionManager: SessionManagerInstance;
    if (recentFile && existsSync(recentFile)) {
      sessionManager = sdk.SessionManager.open(
        recentFile,
        sessionDir,
        cwd,
      ) as SessionManagerInstance;
    } else {
      sessionManager = sdk.SessionManager.create(cwd, sessionDir) as SessionManagerInstance;
    }

    // 解析模型
    let model: PiModel | undefined;
    if (providerId) model = this.resolveModel(providerId);
    if (!model) {
      // 回退：取第一个可用模型
      const available = await this.modelRuntime?.getAvailable();
      model = available && available.length > 0 ? (available[0] as PiModel) : undefined;
    }
    if (!model) {
      throw new Error("未配置可用模型，请先在设置中添加模型并配置 API Key");
    }

    const isWorkspace = task.type === "workspace";
    const { session } = await sdk.createAgentSession({
      cwd,
      model,
      modelRuntime: this.modelRuntime ?? undefined,
      sessionManager,
      tools: isWorkspace ? ["read", "write", "edit", "bash", "grep", "find", "ls"] : ["read", "ls"],
    });

    const unsubscribe = session.subscribe((event: unknown) => {
      this.translateAndEmit(task.id, event);
    });

    this.sessions.set(task.id, { session, unsubscribe });
  }

  /** 发送消息，支持按任务切换模型 */
  async prompt(taskId: string, text: string, providerId?: string): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) throw new Error(`任务会话不存在: ${taskId}`);

    if (providerId) {
      const model = this.resolveModel(providerId);
      if (model && typeof state.session.setModel === "function") {
        try {
          await state.session.setModel(model);
        } catch (err) {
          this.emitError(
            taskId,
            `切换模型失败: ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
      }
    }

    await state.session.prompt(text);
  }

  /** 中止当前流 */
  async abort(taskId: string): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) return;
    await state.session.abort();
  }

  /** 任务是否有活跃会话 */
  hasSession(taskId: string): boolean {
    return this.sessions.has(taskId);
  }

  /** 关闭并清理任务会话 */
  disposeSession(taskId: string): void {
    const state = this.sessions.get(taskId);
    if (state) {
      state.unsubscribe();
      this.sessions.delete(taskId);
    }
  }

  // ── 事件映射（见 §3.2） ───────────────────

  private emit(streamId: string, event: WithoutStreamId<AgentEvent>): void {
    if (this.emitter) this.emitter({ streamId, ...event } as AgentEvent);
  }

  private translateAndEmit(taskId: string, event: unknown): void {
    const e = event as { type: string; [k: string]: unknown };
    const emit = (ev: WithoutStreamId<AgentEvent>) => this.emit(taskId, ev);

    switch (e.type) {
      case "message_start": {
        emit({ type: "message_start" });
        break;
      }
      case "message_end": {
        const message = e.message as { stopReason?: string } | undefined;
        emit({ type: "message_end", payload: { stopReason: message?.stopReason } });
        break;
      }
      case "turn_end": {
        emit({ type: "turn_end" });
        break;
      }
      case "message_update": {
        this.handleMessageUpdate(taskId, e);
        break;
      }
      case "tool_execution_start": {
        emit({
          type: "tool_execution_start",
          payload: {
            toolCallId: e.toolCallId as string,
            toolName: e.toolName as string,
            args: e.args,
          },
        });
        break;
      }
      case "tool_execution_update": {
        const delta =
          typeof e.partialResult === "string"
            ? e.partialResult
            : JSON.stringify(e.partialResult ?? "");
        emit({
          type: "tool_execution_update",
          payload: { toolCallId: e.toolCallId as string, delta },
        });
        break;
      }
      case "tool_execution_end": {
        emit({
          type: "tool_execution_end",
          payload: {
            toolCallId: e.toolCallId as string,
            ok: !e.isError,
            output: e.result,
            error: e.isError ? this.extractError(e.result) : undefined,
          },
        });
        break;
      }
      default:
        // 未关注的事件（compaction / auto_retry / session_info_changed 等）忽略
        break;
    }
  }

  /** 处理 message_update：解构 assistantMessageEvent 为内容块事件 */
  private handleMessageUpdate(taskId: string, e: { [k: string]: unknown }): void {
    const ame = e.assistantMessageEvent as
      | {
          type: string;
          contentIndex?: number;
          delta?: string;
          content?: string;
          toolCall?: unknown;
          partial?: { content?: Array<{ id?: string }> };
        }
      | undefined;
    if (!ame) return;
    const contentIndex = ame.contentIndex ?? 0;
    const emit = (ev: WithoutStreamId<AgentEvent>) => this.emit(taskId, ev);

    switch (ame.type) {
      case "thinking_start":
        emit({ type: "thinking_start", payload: { contentIndex } });
        break;
      case "thinking_delta":
        emit({ type: "thinking_delta", payload: { contentIndex, delta: ame.delta ?? "" } });
        break;
      case "thinking_end":
        emit({ type: "thinking_end", payload: { contentIndex, content: ame.content ?? "" } });
        break;
      case "text_start":
        emit({ type: "text_start", payload: { contentIndex } });
        break;
      case "text_delta":
        emit({ type: "text_delta", payload: { contentIndex, delta: ame.delta ?? "" } });
        break;
      case "text_end":
        emit({ type: "text_end", payload: { contentIndex, content: ame.content ?? "" } });
        break;
      case "toolcall_start": {
        // toolCallId 在 toolcall_start 时已由 pi 分配，存于 partial.content[contentIndex]
        const partial = (ame.partial ?? e.message) as
          | { content?: Array<{ id?: string }> }
          | undefined;
        const block = partial?.content?.[contentIndex];
        const toolCallId = block?.id ?? randomUUID();
        emit({ type: "toolcall_start", payload: { contentIndex, toolCallId } });
        break;
      }
      case "toolcall_delta":
        emit({ type: "toolcall_delta", payload: { contentIndex, delta: ame.delta ?? "" } });
        break;
      case "toolcall_end": {
        const tc = ame.toolCall as { id: string; name: string; arguments: unknown } | undefined;
        if (tc) {
          emit({
            type: "toolcall_end",
            payload: { contentIndex, toolCall: tc },
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private extractError(result: unknown): string | undefined {
    if (typeof result === "string") return result;
    if (result && typeof result === "object" && "error" in result) {
      const err = (result as { error: unknown }).error;
      return typeof err === "string" ? err : JSON.stringify(err);
    }
    return undefined;
  }
}

export const agentRuntime = new AgentRuntime();
export type { ModelProviderConfig };
