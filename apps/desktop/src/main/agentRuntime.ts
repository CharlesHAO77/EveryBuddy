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
import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ResourceDiagnostic,
  Skill,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AttachmentRef,
  ExecutionMode,
  HistoryMessage,
  TaskMeta,
} from "@everybuddy/ipc-contract";
import { getAgentConfig } from "./agentConfigStore";
import { configStore } from "./configStore";
import { connectorStore } from "./connectorStore";
import { expertStore, expertToAgentConfig, findExpert } from "./expertStore";
import { buildExtensionFactories, DEFAULT_EXTENSIONS } from "./extensions";
import { buildMcpTools } from "./mcpTools";
import { skillStore } from "./skillStore";
import {
  buildImageDescriptionBlock,
  buildManifestText,
  parseFileContent,
  resolveInUploads,
  stageAttachments,
} from "./fileParser";
import { buildFullPath, entriesToHistory } from "./historyMapper";
import {
  AUTH_PATH,
  getApiKey,
  getImageGenModel,
  getProvider,
  getVisionModel,
  isChatModelProviderId,
  MODELS_JSON_PATH,
} from "./modelStore";
import { getModeSystemPrompt } from "./prompts";
import { createFindOperations } from "./tools/findTool";
import { createGenerateImageToolDefinition } from "./tools/generateImageTool";
import { createGrepToolDefinition } from "./tools/grepTool";
import { buildToolAllowlist } from "./tools/toolAllowlist";
import {
  buildToolPlan,
  detectToolAvailability,
  type ToolAvailability,
} from "./tools/toolAvailability";
import { createUnderstandImageToolDefinition } from "./tools/understandImageTool";
import { type DescribeImageRuntime, describeImage } from "./vision";
import { getTaskCwd, resolveSessionLocation } from "./workspaceManager";

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
  /** 扩展控制器（侧信道，ipcRouter:agent:extension-command 经 runExtensionCommand 调用） */
  controllers: Record<string, unknown>;
}

class AgentRuntime {
  private sdk: CodingAgentSDK | null = null;
  private modelRuntime: ModelRuntime | null = null;
  private sessions = new Map<string, RuntimeState>();
  /** 事件输出监听器（多订阅：ipcRouter 广播到渲染进程，scheduler 采集定时运行结果） */
  private listeners = new Set<(event: AgentEvent) => void>();
  /** 工具可用性机器级快照（探测一次，进程内缓存；见 tools/toolAvailability.ts） */
  private availability: ToolAvailability | null = null;
  /** 任务执行模式（auto/manual/plan），由渲染进程经 agent:set-mode 下发，供权限扩展实时读取 */
  private taskModes = new Map<string, ExecutionMode>();
  /**
   * 每任务 abort 请求标志：abort() 置位；收到 stopReason==="aborted" 的 message_end 清除。
   * 若 abort 发生在工具执行中，message_end 早已发过（stopReason "stop"），不会再收到 "aborted"，
   * 故 agent_end 时标志仍在 → 合成一条 message_end { stopReason: "aborted" }（渲染层统一 handler）。
   */
  private abortRequested = new Set<string>();

  /** 切换某任务的执行模式 */
  setTaskMode(taskId: string, mode: ExecutionMode): void {
    this.taskModes.set(taskId, mode);
  }

  /** 读取某任务执行模式（缺省 auto，保持既有自动执行行为） */
  getTaskMode(taskId: string): ExecutionMode {
    return this.taskModes.get(taskId) ?? "auto";
  }

  /** 订阅归一化事件流（返回退订函数；支持多订阅者） */
  onEvent(fn: (event: AgentEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
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

    // 按任务模式读取办公/编码 agent 配置（旧任务缺省 daily，行为不回归）；
    // 任务选用了专家时，在其基础上叠加 Expert 覆盖字段（builtin 专家无覆盖 → 等价于基础配置，零行为变更）
    const mode = task.mode ?? "daily";
    let cfg = getAgentConfig(mode);
    if (task.expertId) {
      const expert = findExpert(task.expertId);
      if (expert) cfg = expertToAgentConfig(expert, cfg);
    }

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

    // 视觉/生图 provider 实时解析：专家覆盖后的 agent 配置优先，其次能力标签；
    // 每次调用重新解析，新打标签的模型无需重建会话即可生效
    const resolveVisionProviderId = (): string | undefined => cfg.visionModelProviderId ?? getVisionModel();
    const resolveImageGenProviderId = (): string | undefined =>
      cfg.imageGenModelProviderId ?? getImageGenModel();

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
        describeImage: (model, image, question, signal) =>
          describeImage(
            this.modelRuntime as unknown as DescribeImageRuntime,
            model,
            image,
            question,
            signal,
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

    // 连接器注入：status=connected + enabled 的 MCP 连接器 → 其工具并入 customTools
    // （reserved/disconnected 不进 loader；连接失败静默返回空数组，不影响会话建立）
    const mcpConnectors = connectorStore
      .list()
      .filter((c) => c.type === "mcp" && c.enabled && c.status === "connected");
    for (const mcp of mcpConnectors) {
      customTools.push(...(await buildMcpTools(mcp)));
    }

    // 扩展：构建工厂 + 控制器 + 贡献的工具名（并入 allowlist）。emit 闭包绑定本 task，
    // 扩展内 emit(extension_status/notify) 会经 this.emit 推送到对应渲染进程
    const extensions = cfg.extensions ?? DEFAULT_EXTENSIONS[mode];
    const extEmit = (evt: WithoutStreamId<AgentEvent>) => this.emit(task.id, evt);
    const {
      factories,
      controllers,
      tools: extTools,
    } = buildExtensionFactories(extensions, extEmit, {
      getMode: () => this.getTaskMode(task.id),
    });

    // tools allowlist 会过滤所有工具（含 customTools / 扩展注册工具，见 SDK agent-session _refreshToolRegistry），
    // 视觉理解/生图/扩展工具必须显式并入（buildToolAllowlist），否则注册了也不会暴露给模型
    const toolAllowlist = buildToolAllowlist(plan.tools, [...(cfg.tools ?? []), ...extTools]);

    // 模式级 system prompt：cfg.systemPrompt 覆盖默认；默认 builder 按当前激活工具动态拼出清单。
    // customPrompt 分支下 SDK 不再注入内置工具列表/guidelines，但会追加 appendSystemPrompt + project_context + skills + cwd
    const systemPrompt =
      cfg.systemPrompt ?? getModeSystemPrompt(mode, { activeTools: toolAllowlist });

    // 技能注入：把启用的 EveryBuddy 技能并入 SDK 自动发现的技能（skillsOverride 单一注入点，
    // 见 §7；enabled=false 的技能已由 skillStore.listEnabled() 过滤，不进 override）
    const managedSkills = skillStore.listEnabled();
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir: sdk.getAgentDir(),
      systemPrompt,
      appendSystemPrompt: cfg.appendSystemPrompt ?? undefined,
      extensionFactories: factories,
      ...(managedSkills.length > 0
        ? {
            skillsOverride: (base: {
              skills: Skill[];
              diagnostics: ResourceDiagnostic[];
            }) => {
              const mine: Skill[] = managedSkills.map((s) => ({
                name: s.id,
                description: s.description,
                filePath: s.filePath,
                baseDir: s.baseDir,
                sourceInfo: sdk.createSyntheticSourceInfo(s.filePath, { source: "everybuddy" }),
                disableModelInvocation: false,
              }));
              return { skills: [...base.skills, ...mine], diagnostics: base.diagnostics };
            },
          }
        : {}),
    });
    await resourceLoader.reload();

    const { session } = await sdk.createAgentSession({
      cwd,
      model,
      modelRuntime: this.modelRuntime ?? undefined,
      sessionManager,
      tools: toolAllowlist,
      customTools,
      resourceLoader,
    });

    // 多次转向合并：steeringMode "all" 把同一时刻排队的多条转向消息一起注入、
    // 合并为一个响应（默认 one-at-a-time 会各自产生一个 turn）；持久化到 SDK settings
    session.setSteeringMode("all");

    const unsubscribe = session.subscribe((event: unknown) => {
      this.translateAndEmit(task.id, event);
    });

    this.sessions.set(task.id, { session, unsubscribe, controllers });
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

  /** 仅当目标是可对话模型时切换会话模型；失败经事件流报错并返回 false */
  private async resolveAndSetModel(
    taskId: string,
    state: RuntimeState,
    providerId?: string,
  ): Promise<boolean> {
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
          return false;
        }
      }
    }
    return true;
  }

  /**
   * 构造完整 prompt 文本（prompt/steer/followUp 共用）：
   * 附件暂存到 uploads/ + 视觉自动调度（非视觉模型先用视觉模型描述图片）+ 附件清单。
   * 注意：本段的「图片附件 + 非视觉模型自动描述」不在工具内、时段极短，不接取消（特性②仅覆盖工具内调用）。
   * 失败经事件流报错并返回 null。
   */
  private async buildPromptText(
    taskId: string,
    text: string,
    providerId?: string,
    attachments?: AttachmentRef[],
  ): Promise<string | null> {
    if (!attachments || attachments.length === 0) return text;

    const task = configStore.getTask(taskId);
    const cwd = task ? getTaskCwd(task) : undefined;
    if (!task || !cwd) {
      this.emitError(taskId, "无法定位任务工作目录");
      return null;
    }
    try {
      const staged = await stageAttachments(attachments, cwd);
      const copied = staged.filter((s) => !s.skipped);
      if (copied.length === 0) {
        this.emitError(taskId, `附件暂存失败：${staged[0]?.error ?? "未知错误"}`);
        return null;
      }

      // 视觉自动调度：当前模型无视觉 + 图片附件 → 用视觉模型描述并注入文本，不把裸图发给非视觉模型
      const providerIdEffective = providerId ?? task.providerId;
      const currentModel = providerIdEffective ? this.resolveModel(providerIdEffective) : undefined;
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
          return null;
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

      return text.trim()
        ? `${text}\n\n${manifest}${descBlock ? `\n\n${descBlock}` : ""}`
        : `${manifest}${descBlock ? `\n\n${descBlock}` : ""}`;
    } catch (err) {
      this.emitError(taskId, `附件处理失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
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

    if (!(await this.resolveAndSetModel(taskId, state, providerId))) return;
    const fullText = await this.buildPromptText(taskId, text, providerId, attachments);
    if (fullText === null) return;

    try {
      await state.session.prompt(fullText);
    } catch (err) {
      this.emitError(taskId, `发送消息失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * 转向/排队发送（/steer /follow-up 与运行中「转向/排队」选择器）。
   * SDK steer()/followUp() 仅排队、空闲时不启动 run（agent 循环未运行），
   * 故空闲必须回退 session.prompt。
   * 运行中：steer=**原生转向**（session.steer 在下一 turn 边界以 user 消息注入并开新 turn，
   * 不再 abort+prompt 硬打断；被转向的在途消息自然结束，渲染层据 queue_update 标记「已转向」）、
   * followUp=排队（session.followUp，完成后自动处理）。
   */
  async steerMessage(
    taskId: string,
    text: string,
    channel: "steer" | "followUp",
    providerId?: string,
    attachments?: AttachmentRef[],
  ): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) {
      this.emitError(taskId, "任务会话未就绪，请稍后重试或重新选择任务");
      return;
    }

    if (!(await this.resolveAndSetModel(taskId, state, providerId))) return;
    const fullText = await this.buildPromptText(taskId, text, providerId, attachments);
    if (fullText === null) return;

    try {
      if (state.session.isIdle) {
        // 空闲：steer/followUp 都等同普通发送
        await state.session.prompt(fullText);
      } else if (channel === "steer") {
        // 原生转向：入 steering 队列，当前 turn 边界处注入（不再先取消再发送）
        await state.session.steer(fullText);
      } else {
        // 排队 = 当前生成完成后自动处理
        await state.session.followUp(fullText);
      }
    } catch (err) {
      this.emitError(taskId, `发送消息失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 清空排队（steer + followUp），返回被清空的内容；渲染层单项取消后据此重排剩余项 */
  async clearQueue(taskId: string): Promise<{ steering: string[]; followUp: string[] }> {
    const state = this.sessions.get(taskId);
    if (!state) return { steering: [], followUp: [] };
    return state.session.clearQueue();
  }

  /** 中止当前流（置 abortRequested 标志；若 abort 落在工具执行期，agent_end 时合成 aborted message_end） */
  async abort(taskId: string): Promise<void> {
    const state = this.sessions.get(taskId);
    if (!state) return;
    this.abortRequested.add(taskId);
    await state.session.abort();
  }

  /** 触发扩展控制器方法（ipcRouter:agent:extension-command -> 控制器侧信道） */
  runExtensionCommand(taskId: string, extension: string, command: string): void {
    const state = this.sessions.get(taskId);
    if (!state) return;
    const controller = state.controllers[extension] as { [k: string]: unknown } | undefined;
    if (!controller) return;
    const fn = controller[command];
    if (typeof fn === "function") fn.call(controller);
  }

  /** 应答工具权限确认：恢复 permission 扩展中被暂停的工具调用（agent:approveTool） */
  resolveToolApproval(taskId: string, requestId: string, approved: boolean): void {
    const state = this.sessions.get(taskId);
    if (!state) return;
    const ctrl = state.controllers["permission"] as
      | { resolve?: (r: string, a: boolean) => void }
      | undefined;
    ctrl?.resolve?.(requestId, approved);
  }

  /**
   * 从指定 assistant 条目分叉出新会话（task:branch）。
   * 用临时 SessionManager.open() 调 createBranchedSession（它会变更该 manager 的 file 指针，
   * 不能用任务活跃会话的 manager）；分支文件先落在原 sessionDir，再移入新任务的 sessionDir。
   */
  async branchTask(taskId: string, entryId: string): Promise<TaskMeta> {
    const sdk = await this.load();
    const task = configStore.getTask(taskId);
    if (!task) throw new Error("任务不存在");
    const recentFile = findMostRecentSessionFile(task.sessionDir);
    if (!recentFile || !existsSync(recentFile)) {
      throw new Error("找不到会话记录，无法创建分支");
    }

    const sm = sdk.SessionManager.open(
      recentFile,
      task.sessionDir,
      getTaskCwd(task),
    ) as SessionManagerInstance;
    let newSessionFile: string | undefined;
    try {
      newSessionFile = sm.createBranchedSession(entryId);
    } catch (err) {
      throw new Error(
        `创建分支失败（条目可能不存在）: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!newSessionFile) throw new Error("创建分支失败：会话未持久化");

    // 新任务：复制类型/模式/模型/空间，解析新 sessionDir（临时任务取新 workDir）
    const workspace = task.workspaceId ? configStore.getWorkspace(task.workspaceId) : undefined;
    const { sessionDir: newSessionDir, workDir } = resolveSessionLocation(task.type, workspace);
    const now = new Date().toISOString();
    const newTask: TaskMeta = {
      id: randomUUID(),
      title: `${task.title} · 分支`,
      type: task.type,
      mode: task.mode,
      workspaceId: task.workspaceId,
      workspacePath: task.workspacePath,
      workDir,
      providerId: task.providerId,
      sessionDir: newSessionDir,
      createdAt: now,
      updatedAt: now,
    };

    // 分支文件落到原 sessionDir（open 时持久化），移入新任务的 sessionDir
    renameSync(newSessionFile, path.join(newSessionDir, path.basename(newSessionFile)));

    configStore.addTask(newTask);
    // 阻塞至会话就绪，避免与紧随的 prompt 竞态；失败经事件流报错，不阻断分支创建
    try {
      await this.createTaskSession(newTask, newTask.providerId);
    } catch (err) {
      console.error(`[agentRuntime] 分支会话初始化失败:`, err);
      this.emitError(
        newTask.id,
        `会话初始化失败: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return newTask;
  }

  /**
   * agent_settled 后下发 assistant 条目 id 映射（message_entry_ids）。
   * 渲染层按 sdkTimestamp 匹配写 entryId，作为分支锚点（流式新消息是随机 uuid，需此回填）。
   */
  private emitEntryIds(taskId: string): void {
    const state = this.sessions.get(taskId);
    if (!state) return;
    try {
      const sm = state.session.sessionManager as SessionManagerInstance;
      const leafId = sm.getLeafId();
      if (!leafId) return;
      const entries: Array<{ sdkTimestamp: number; entryId: string }> = [];
      for (const entry of sm.getBranch(leafId)) {
        if (entry.type !== "message") continue;
        const msg = entry.message as { role?: string; timestamp?: number } | undefined;
        if (msg?.role !== "assistant" || typeof msg.timestamp !== "number") continue;
        entries.push({ sdkTimestamp: msg.timestamp, entryId: entry.id });
      }
      if (entries.length > 0) {
        this.emit(taskId, { type: "message_entry_ids", payload: { entries } });
      }
    } catch (err) {
      console.warn(`[agentRuntime] emitEntryIds 失败:`, err);
    }
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
    // 未应答的工具权限按拒绝处理，避免工具永久阻塞
    (state.controllers["permission"] as { dispose?: () => void } | undefined)?.dispose?.();
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
   * 注意：用 buildFullPath 走完整 leaf 路径而非 SDK 的 buildContextEntries
   * （后者是压缩感知的，会丢弃 compaction 之前的旧消息），并在压缩边界插入摘要提示。
   */
  async loadHistory(taskId: string): Promise<HistoryMessage[]> {
    const sdk = await this.load();
    const state = this.sessions.get(taskId);
    let sm: SessionManagerInstance | null = null;
    if (state) {
      sm = state.session.sessionManager;
    } else {
      const task = configStore.getTask(taskId);
      if (task) {
        const cwd = getTaskCwd(task);
        const recentFile = findMostRecentSessionFile(task.sessionDir);
        if (recentFile && existsSync(recentFile)) {
          sm = sdk.SessionManager.open(recentFile, task.sessionDir, cwd) as SessionManagerInstance;
        }
      }
    }
    if (!sm) return [];
    return entriesToHistory(buildFullPath(sm), { compactionNotices: true });
  }

  // ── 事件映射（见 §3.2） ───────────────────

  private emit(streamId: string, event: WithoutStreamId<AgentEvent>): void {
    for (const listener of this.listeners) {
      listener({ streamId, ...event } as AgentEvent);
    }
  }

  private translateAndEmit(taskId: string, event: unknown): void {
    const e = event as { type: string; [k: string]: unknown };
    const emit = (ev: WithoutStreamId<AgentEvent>) => this.emit(taskId, ev);

    switch (e.type) {
      case "message_start": {
        // SDK 对 user/assistant/toolResult 消息均发 message_start；仅 assistant 需要创建流式消息。
        // 透传 SDK 自身时间戳（避免双进程时钟偏差），渲染层据此匹配 entryId 锚点
        const message = e.message as { role?: string; timestamp?: number } | undefined;
        if (message?.role === "assistant") {
          emit({
            type: "message_start",
            payload: { sdkTimestamp: message.timestamp ?? Date.now() },
          });
        }
        break;
      }
      case "message_end": {
        const message = e.message as
          | {
              role?: string;
              stopReason?: string;
              usage?: {
                input?: number;
                output?: number;
                cacheRead?: number;
                cacheWrite?: number;
                totalTokens?: number;
                reasoning?: number;
                cost?: { input?: number; output?: number; total?: number };
              };
              model?: string;
              provider?: string;
            }
          | undefined;
        if (message?.role === "assistant") {
          if (message.stopReason === "aborted") this.abortRequested.delete(taskId);
          emit({
            type: "message_end",
            payload: {
              stopReason: message.stopReason,
              usage: message.usage
                ? {
                    input: message.usage.input ?? 0,
                    output: message.usage.output ?? 0,
                    cacheRead: message.usage.cacheRead ?? 0,
                    cacheWrite: message.usage.cacheWrite ?? 0,
                    totalTokens: message.usage.totalTokens ?? 0,
                    reasoning: message.usage.reasoning,
                    cost: message.usage.cost
                      ? {
                          input: message.usage.cost.input ?? 0,
                          output: message.usage.cost.output ?? 0,
                          total: message.usage.cost.total ?? 0,
                        }
                      : undefined,
                  }
                : undefined,
              model: message.model,
              provider: message.provider,
            },
          });
        }
        break;
      }
      case "turn_end": {
        emit({ type: "turn_end" });
        break;
      }
      case "agent_end": {
        // abort 发生在工具执行期时不会再有 "aborted" 的 message_end，合成一条保持取消语义统一
        if (this.abortRequested.delete(taskId)) {
          emit({ type: "message_end", payload: { stopReason: "aborted" } });
        }
        emit({ type: "agent_end" });
        break;
      }
      case "agent_settled": {
        // 兜底：SDK 某些路径（如工具执行中 abort）可能只发 agent_settled 不发 agent_end，
        // 此时若 abortRequested 仍在 → 同样合成 aborted message_end，取消语义一致
        if (this.abortRequested.delete(taskId)) {
          emit({ type: "message_end", payload: { stopReason: "aborted" } });
        }
        emit({ type: "agent_settled" });
        // 结算后条目已落盘，下发 assistant 条目 id 映射（分支锚点）
        this.emitEntryIds(taskId);
        break;
      }
      case "queue_update": {
        // SDK 排队状态（steer/followUp 队列），驱动渲染层「已排队」指示
        emit({
          type: "queue_update",
          payload: {
            steering: Array.isArray(e.steering) ? (e.steering as string[]).slice() : [],
            followUp: Array.isArray(e.followUp) ? (e.followUp as string[]).slice() : [],
          },
        });
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
            toolName: e.toolName as string,
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
