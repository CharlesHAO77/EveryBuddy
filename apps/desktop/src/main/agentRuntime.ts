/**
 * AgentRuntime - pi-coding-agent 运行时封装层（见 docs/architecture.md §5.1, §0.4）。
 *
 * 职责：
 *  1. 动态加载 @earendil-works/pi-coding-agent（ESM，运行时 import()）
 *  2. 管理 ModelRuntime（models.json + auth.json 由 modelStore 以 SDK 原生格式维护，见 §7.3）
 *  3. 为每个任务创建 AgentSession（SessionManager 落盘到对应目录）
 *  4. 将 pi 内容块粒度事件归一化为 AgentEvent，回调推送给 ipcRouter 广播
 *
 * 事件映射见 §0.4 / §3.2。
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SessionEntry, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AttachmentRef,
  HistoryBlock,
  HistoryMessage,
  TaskMeta,
} from "@everybuddy/ipc-contract";
import { getAgentConfig } from "./agentConfigStore";
import { configStore } from "./configStore";
import {
  buildImageDescriptionBlock,
  buildManifestText,
  parseFileContent,
  resolveInUploads,
  splitFileMarkers,
  stageAttachments,
} from "./fileParser";
import {
  AUTH_PATH,
  getApiKey,
  getImageGenModel,
  getProvider,
  getVisionModel,
  isChatModelProviderId,
  MODELS_JSON_PATH,
} from "./modelStore";
import { createFindOperations } from "./tools/findTool";
import { createGenerateImageToolDefinition } from "./tools/generateImageTool";
import { createGrepToolDefinition } from "./tools/grepTool";
import {
  buildToolPlan,
  detectToolAvailability,
  type ToolAvailability,
} from "./tools/toolAvailability";
import { buildToolAllowlist } from "./tools/toolAllowlist";
import { createUnderstandImageToolDefinition } from "./tools/understandImageTool";
import { type DescribeImageRuntime, describeImage } from "./vision";
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

/** models-store.json 缓存重定向到系统临时目录，避免远程目录缓存落入 ~/EveryBuddy */
const MODELS_STORE_TMP_PATH = path.join(tmpdir(), "everybuddy-models-store.json");

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
  /** 工具可用性机器级快照（探测一次，进程内缓存；见 tools/toolAvailability.ts） */
  private availability: ToolAvailability | null = null;

  setEmitter(fn: (event: AgentEvent) => void): void {
    this.emitter = fn;
  }

  /** 向渲染进程推送错误事件（供 ipcRouter 在会话初始化失败时调用） */
  emitError(streamId: string, message: string): void {
    this.emit(streamId, { type: "error", payload: { message } });
  }

  /** 探测并缓存本机工具可用性（bash 真实路径、rg/fd 是否可用的机器级快照） */
  private getAvailability(): ToolAvailability {
    if (!this.availability) this.availability = detectToolAvailability();
    return this.availability;
  }

  /** 动态加载 ESM 包 */
  private async load(): Promise<CodingAgentSDK> {
    if (this.sdk) return this.sdk;
    const sdk = await import("@earendil-works/pi-coding-agent");
    this.sdk = sdk;
    return sdk;
  }

  /** 初始化 ModelRuntime（models.json + auth.json 由 modelStore 维护，凭证自动读取） */
  async init(): Promise<void> {
    this.modelRuntime = await this.createRuntime();
  }

  /** 重建 ModelRuntime（新增/更新/删除模型或密钥后调用，重新加载 models.json + auth.json） */
  async refreshModel(): Promise<void> {
    this.modelRuntime = await this.createRuntime();
  }

  private async createRuntime(): Promise<ModelRuntime> {
    const sdk = await this.load();
    return sdk.ModelRuntime.create({
      authPath: AUTH_PATH,
      modelsPath: MODELS_JSON_PATH,
      modelsStorePath: MODELS_STORE_TMP_PATH,
      allowModelNetwork: false,
    });
  }

  /** 解析模型对象 */
  private resolveModel(providerId: string): PiModel | undefined {
    if (!this.modelRuntime) return undefined;
    const provider = getProvider(providerId);
    if (!provider) return undefined;
    return this.modelRuntime.getModel(providerId, provider.models[0]?.id ?? "") as
      | PiModel
      | undefined;
  }

  /** 为任务创建/恢复 AgentSession */
  async createTaskSession(task: TaskMeta, providerId?: string): Promise<void> {
    const sdk = await this.load();
    if (!this.modelRuntime) await this.init();

    const cwd = getTaskCwd(task);
    const sessionDir = task.sessionDir;
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

    // 按任务模式读取办公/编码 agent 配置（旧任务缺省 daily，行为不回归）
    const mode = task.mode ?? "daily";
    const cfg = getAgentConfig(mode);

    // 恢复已有会话或新建（SDK 声明了 findMostRecentSession 但运行时未导出，自行按 mtime 取最近 .jsonl）
    const recentFile = findMostRecentSessionFile(sessionDir);
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

    // 解析模型：调用方指定 → 模式配置默认 → 第一个可用（与旧逻辑一致）；
    // 每处都过滤 image 专用 provider（SDK 把无 input 的模型默认按 text 处理，会误选生图模型做对话）
    let model: PiModel | undefined;
    if (providerId && isChatModelProviderId(providerId)) model = this.resolveModel(providerId);
    if (!model && cfg.defaultModelProviderId && isChatModelProviderId(cfg.defaultModelProviderId))
      model = this.resolveModel(cfg.defaultModelProviderId);
    if (!model) {
      // 回退：取第一个可对话的可用模型
      const available = await this.modelRuntime?.getAvailable();
      model = available?.find((m) => isChatModelProviderId(m.provider)) as PiModel | undefined;
    }
    if (!model) {
      throw new Error("未配置可用模型，请先在设置中添加模型并配置 API Key");
    }

    // 视觉/生图 provider 实时解析：agent 配置优先，其次能力标签；
    // 每次调用重新解析，新打标签的模型无需重建会话即可生效
    const resolveVisionProviderId = (): string | undefined =>
      getAgentConfig(task.mode ?? "daily").visionModelProviderId ?? getVisionModel();
    const resolveImageGenProviderId = (): string | undefined =>
      getAgentConfig(task.mode ?? "daily").imageGenModelProviderId ?? getImageGenModel();

    // 平台化工具配置：bash 在 Windows 上覆盖为真实 Git Bash（SDK 会误选 WSL stub），
    // grep/find 在缺 rg/fd 时降级为纯 Node 实现（见 tools/toolAvailability.ts）
    const plan = buildToolPlan(this.getAvailability());
    const customTools: ToolDefinition[] = [await this.buildParseAttachmentTool(cwd)];
    if (plan.bashShellPath) {
      // 同名 "bash" 定义经 customTools 覆盖内置 bash（agent-session 注册表按名覆盖），
      // 让其用我们解析的真实 Git Bash，而非 SDK where 命中的 WSL stub
      customTools.push(
        sdk.createBashToolDefinition(cwd, { shellPath: plan.bashShellPath }) as ToolDefinition,
      );
    }
    if (plan.useNodeFind) {
      // fd 缺失：纯 Node glob 兜底覆盖内置 find
      customTools.push(
        sdk.createFindToolDefinition(cwd, { operations: createFindOperations() }) as ToolDefinition,
      );
    }
    if (plan.useNodeGrep) {
      // rg 缺失：纯 Node 搜索兜底覆盖内置 grep
      customTools.push(await createGrepToolDefinition(cwd));
    }

    // 视觉理解 / 生图自定义工具（办公模式能力；工具内部按需解析视觉/生图模型）
    customTools.push(
      await createUnderstandImageToolDefinition(cwd, {
        resolveVisionModel: () => {
          const pid = resolveVisionProviderId();
          return pid ? this.resolveModel(pid) : undefined;
        },
        describeImage: (model, image, question) =>
          describeImage(
            this.modelRuntime as unknown as DescribeImageRuntime,
            model,
            image,
            question,
          ),
        visionProviderId: resolveVisionProviderId,
      }),
    );
    customTools.push(
      await createGenerateImageToolDefinition(cwd, {
        resolveImageGenProvider: () => {
          const pid = resolveImageGenProviderId();
          if (!pid) return undefined;
          const provider = getProvider(pid);
          if (!provider) return undefined;
          return {
            providerId: pid,
            baseUrl: provider.baseUrl,
            model: provider.models[0]?.id ?? "",
          };
        },
        getApiKey,
      }),
    );

    // 模式级 system prompt：createAgentSession 不会 reload 调用方提供的 loader，须自行 reload
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir: sdk.getAgentDir(),
      systemPrompt: cfg.systemPrompt ?? undefined,
      appendSystemPrompt: cfg.appendSystemPrompt ?? undefined,
    });
    await resourceLoader.reload();

    // tools allowlist 会过滤所有工具（含 customTools，见 SDK agent-session _refreshToolRegistry），
    // 视觉理解/生图工具必须显式并入（buildToolAllowlist），否则注册了也不会暴露给模型。
    const toolAllowlist = buildToolAllowlist(plan.tools, cfg.tools);

    const { session } = await sdk.createAgentSession({
      cwd,
      model,
      modelRuntime: this.modelRuntime ?? undefined,
      sessionManager,
      tools: toolAllowlist,
      customTools,
      resourceLoader,
    });

    const unsubscribe = session.subscribe((event: unknown) => {
      this.translateAndEmit(task.id, event);
    });

    this.sessions.set(task.id, { session, unsubscribe });
  }

  /**
   * 构造 parse_attachment 自定义工具：让 Agent 按需解析 uploads/ 下的附件
   * （PDF/DOCX/XLSX/PPTX 等 read 工具读不了的二进制文档）。闭包捕获任务 cwd，
   * 路径经 resolveInUploads 严格限定在 uploads/ 内。
   */
  private async buildParseAttachmentTool(
    cwd: string,
  ): Promise<ReturnType<CodingAgentSDK["defineTool"]>> {
    const sdk = await this.load();
    const { Type } = await import("typebox");
    return sdk.defineTool({
      name: "parse_attachment",
      label: "解析附件",
      description:
        "解析上传的附件文件为文本或图片内容。文本/图片文件直接用内置 read 工具即可；本工具用于 PDF/Word/Excel/PPT 等办公文档。参数 file 为 uploads/ 目录下的文件名（如 report.pdf 或 uploads/report.pdf）。",
      parameters: Type.Object({
        file: Type.String({ description: "uploads/ 下的文件名或相对路径" }),
      }),
      execute: async (_toolCallId: string, params: { file: string }) => {
        const filePath = resolveInUploads(path.join(cwd, "uploads"), params.file);
        if (!filePath) {
          return {
            content: [{ type: "text", text: "[无效路径：文件必须位于 uploads/ 目录下]" }],
            details: {},
          };
        }
        const { content } = await parseFileContent(filePath);
        return { content, details: {} };
      },
    });
  }

  /** 发送消息，支持按任务切换模型与附带附件（附件复制到 uploads/，Agent 按需读取） */
  async prompt(
    taskId: string,
    text: string,
    providerId?: string,
    attachments?: AttachmentRef[],
  ): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) {
      // 会话未就绪（竞态或初始化失败）：经事件流报错，避免 IPC reject 变成未处理异常
      this.emitError(taskId, "任务会话未就绪，请稍后重试或重新选择任务");
      return;
    }

    // 仅当目标是可对话模型时才切换（任务里残留的 image providerId 保持会话原模型）
    if (providerId && isChatModelProviderId(providerId)) {
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

    // 附件：复制到任务工作目录 uploads/ 并构建清单文本，Agent 决定何时用 read/parse_attachment 解析
    let fullText = text;
    if (attachments && attachments.length > 0) {
      const task = configStore.getTask(taskId);
      const cwd = task ? getTaskCwd(task) : undefined;
      if (!task || !cwd) {
        this.emitError(taskId, "无法定位任务工作目录");
        return;
      }
      try {
        const staged = await stageAttachments(attachments, cwd);
        const copied = staged.filter((s) => !s.skipped);
        if (copied.length === 0) {
          this.emitError(taskId, `附件暂存失败：${staged[0]?.error ?? "未知错误"}`);
          return;
        }

        // 视觉自动调度：当前模型无视觉 + 图片附件 → 用视觉模型描述并注入文本，不把裸图发给非视觉模型
        const providerIdEffective = providerId ?? task.providerId;
        const currentModel = providerIdEffective
          ? this.resolveModel(providerIdEffective)
          : undefined;
        const supportsVision = Boolean(currentModel?.input?.includes("image"));
        const imageFiles = staged.filter((s) => !s.skipped && s.category === "image");

        let manifest: string;
        let descBlock = "";
        if (imageFiles.length > 0 && !supportsVision) {
          const visionProviderId =
            getAgentConfig(task.mode ?? "daily").visionModelProviderId ?? getVisionModel();
          const visionModel = visionProviderId ? this.resolveModel(visionProviderId) : undefined;
          if (!visionModel) {
            this.emitError(
              taskId,
              "当前模型不支持图片，且未配置视觉理解模型。请在模型设置中为视觉模型勾选「视觉理解」，或切换支持视觉的模型。",
            );
            return;
          }
          // 逐张图片：解析（缩放）→ 视觉模型描述
          const descs: Array<{ name: string; description: string }> = [];
          for (const f of imageFiles) {
            const { content } = await parseFileContent(f.uploadPath, { resizeImages: true });
            const img = content.find(
              (c): c is { type: "image"; data: string; mimeType: string } => c.type === "image",
            );
            if (img) {
              const description = await describeImage(
                this.modelRuntime as unknown as DescribeImageRuntime,
                visionModel,
                img,
              );
              descs.push({ name: f.uploadName, description });
            }
          }
          manifest = buildManifestText(staged, {
            imageHint:
              "图片已由视觉理解模型自动分析，内容见下方 <image-description> 块（如需针对图片追问，可用 understand_image 工具）",
          });
          descBlock = buildImageDescriptionBlock(descs);
        } else {
          manifest = buildManifestText(staged);
        }

        fullText = text.trim()
          ? `${text}\n\n${manifest}${descBlock ? `\n\n${descBlock}` : ""}`
          : `${manifest}${descBlock ? `\n\n${descBlock}` : ""}`;
      } catch (err) {
        this.emitError(taskId, `附件处理失败: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    try {
      await state.session.prompt(fullText);
    } catch (err) {
      this.emitError(taskId, `发送消息失败: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  /** 关闭并清理任务会话（先中止在途流，再退订） */
  async disposeSession(taskId: string): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) return;
    // 先摘出，阻断后续 prompt 命中
    this.sessions.delete(taskId);
    try {
      await state.session.abort();
    } catch {
      // 未在流式时 abort 可能报错，忽略
    }
    // 退订后迟到的 SDK 事件被丢弃
    state.unsubscribe();
  }

  /**
   * 加载任务的历史消息（用于选中已有任务时回放）。
   * 优先用活跃会话的 sessionManager；无活跃会话则直接打开会话文件读取
   * （不依赖 task:resume 时序）。映射遵循 §0.4 卡片化消息模型。
   */
  async loadHistory(taskId: string): Promise<HistoryMessage[]> {
    const sdk = await this.load();
    let entries: SessionEntry[];
    const state = this.sessions.get(taskId);
    if (state) {
      entries = state.session.sessionManager.buildContextEntries();
    } else {
      const task = configStore.getTask(taskId);
      if (!task) return [];
      const cwd = getTaskCwd(task);
      const recentFile = findMostRecentSessionFile(task.sessionDir);
      if (!recentFile || !existsSync(recentFile)) return [];
      const sm = sdk.SessionManager.open(
        recentFile,
        task.sessionDir,
        cwd,
      ) as SessionManagerInstance;
      entries = sm.buildContextEntries();
    }
    return entriesToHistory(entries);
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
        // SDK 对 user/assistant/toolResult 消息均发 message_start；仅 assistant 需要创建流式消息
        const message = e.message as { role?: string } | undefined;
        if (message?.role === "assistant") {
          emit({ type: "message_start" });
        }
        break;
      }
      case "message_end": {
        const message = e.message as { role?: string; stopReason?: string } | undefined;
        if (message?.role === "assistant") {
          emit({ type: "message_end", payload: { stopReason: message.stopReason } });
        }
        break;
      }
      case "turn_end": {
        emit({ type: "turn_end" });
        break;
      }
      case "agent_end": {
        emit({ type: "agent_end" });
        break;
      }
      case "agent_settled": {
        emit({ type: "agent_settled" });
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
      case "error": {
        // SDK 顶层错误事件（如会话级异常）
        const msg =
          (e as { message?: string; error?: { message?: string } }).error?.message ??
          (e as { message?: string }).message ??
          "未知错误";
        emit({ type: "error", payload: { message: msg } });
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
      case "error": {
        // 模型调用失败（API 错误、鉴权失败等）
        const reason = (ame as { reason?: string }).reason;
        emit({ type: "error", payload: { message: `模型调用失败: ${reason ?? "未知错误"}` } });
        break;
      }
      case "done":
        // AssistantMessageEvent 完成，消息结束由顶层 message_end 事件处理
        break;
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

// ── 历史消息映射 ─────────────────────────────

/** 提取文本内容（content 可能是 string 或内容块数组） */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "",
      )
      .join("");
  }
  return "";
}

/** 将会话条目映射为渲染进程可用的历史消息（见 §0.4 卡片化消息模型） */
function entriesToHistory(entries: SessionEntry[]): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const msg = entry.message as {
      role?: string;
      content?: unknown;
      timestamp?: number;
      errorMessage?: string;
      toolCallId?: string;
      isError?: boolean;
    };
    const ts =
      typeof msg.timestamp === "number" ? msg.timestamp : Date.parse(entry.timestamp) || Date.now();
    const role = msg.role;

    if (role === "user") {
      // 用户消息内容含附件清单标记（<file name="uploads/x" size="n"/>），
      // 拆分为附件 chips + 剩余文本，历史回放据此渲染
      messages.push({
        id: entry.id,
        role: "user",
        timestamp: ts,
        blocks: splitFileMarkers(extractText(msg.content)),
      });
    } else if (role === "assistant") {
      const blocks: HistoryBlock[] = [];
      if (Array.isArray(msg.content)) {
        msg.content.forEach((c, i) => {
          if (!c || typeof c !== "object") return;
          const ct = (c as { type?: string }).type;
          if (ct === "text") {
            blocks.push({
              id: String(i),
              kind: "text",
              content: String((c as { text?: unknown }).text ?? ""),
              done: true,
            });
          } else if (ct === "thinking") {
            blocks.push({
              id: String(i),
              kind: "thinking",
              content: String((c as { thinking?: unknown }).thinking ?? ""),
              done: true,
            });
          } else if (ct === "toolCall") {
            const tc = c as { id?: string; name?: string; arguments?: unknown };
            blocks.push({
              id: String(i),
              kind: "tool",
              toolCallId: tc.id ?? String(i),
              toolName: tc.name ?? "",
              args: tc.arguments,
              argDelta: "",
              status: "success",
              output: undefined,
              outputDelta: "",
              done: true,
            });
          }
        });
      }
      messages.push({
        id: entry.id,
        role: "assistant",
        timestamp: ts,
        blocks,
        errorMessage: msg.errorMessage,
      });
    } else if (role === "toolResult") {
      // 工具结果回填到前一条 assistant 消息中匹配 toolCallId 的工具块
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const toolBlock = lastAssistant?.blocks.find(
        (b) => b.kind === "tool" && b.toolCallId === msg.toolCallId,
      );
      if (toolBlock && toolBlock.kind === "tool") {
        toolBlock.output = msg.content;
        toolBlock.status = msg.isError ? "error" : "success";
        if (msg.isError) toolBlock.error = extractText(msg.content);
      }
    }
    // 其余角色（bashExecution/custom/branchSummary/compactionSummary）跳过
  }
  return messages;
}

/**
 * 扫描会话目录，返回最近修改的 .jsonl 文件路径。
 * SDK 的 d.ts 声明了 findMostRecentSession，但 dist 运行时未导出该函数，
 * 故本地按 mtime 取最新 .jsonl（等价于原打算调用的语义）。
 */
function findMostRecentSessionFile(sessionDir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(sessionDir);
  } catch {
    return null;
  }
  let best: { path: string; mtime: number } | null = null;
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const full = path.join(sessionDir, name);
    try {
      const mtime = statSync(full).mtimeMs;
      if (!best || mtime > best.mtime) best = { path: full, mtime };
    } catch {
      // 忽略不可读文件
    }
  }
  return best?.path ?? null;
}

export const agentRuntime = new AgentRuntime();
