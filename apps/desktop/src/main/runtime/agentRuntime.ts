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
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  AgentEvent,
  AttachmentRef,
  CompactResult,
  ExecutionMode,
  Expert,
  HistoryMessage,
  TaskMeta,
} from "@everybuddy/ipc-contract";
import { uiError } from "../services/errors";
import { buildManifestText, stageAttachments } from "../services/fileParser";
import { buildFullPath, entriesToHistory } from "../services/historyMapper";
import { getTaskCwd, resolveSessionLocation } from "../services/workspaceManager";
import { configStore } from "../stores/configStore";
import { findExpert } from "../stores/expertStore";
import {
  AUTH_PATH,
  getProvider,
  isChatModelProviderId,
  MODELS_JSON_PATH,
} from "../stores/modelStore";
import { teamStore } from "../stores/teamStore";
import { detectToolAvailability, type ToolAvailability } from "../tools/toolAvailability";
import {
  buildSessionConfig,
  type CodingAgentSDK,
  type ModelRuntime,
  type PiModel,
  type SessionManagerInstance,
  type WithoutStreamId,
} from "./sessionBuilder";
import { type TeamRuntimeDeps, teamRuntime } from "./teamRuntime";

/** 本地扩展的 SDK AgentSession 类型（运行时通过动态 import() 加载 ESM 包，见 load()） */
type AgentSession = (CodingAgentSDK["AgentSession"] extends new (
  ...args: never[]
) => infer T
  ? T
  : never) & {
  /** SDK AgentSession 支持运行时切换模型 */
  setModel?: (model: PiModel) => Promise<void> | void;
};

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

  /** 向指定 streamId 推送归一化事件（teamRuntime 等外部生产者经此写入同一监听器集） */
  emitTo(streamId: string, evt: WithoutStreamId<AgentEvent>): void {
    this.emit(streamId, evt);
  }

  /** 供 teamRuntime.wire 注入的依赖（DI，避免 value-import 依赖环；见 teamRuntime.ts） */
  getTeamDeps(): TeamRuntimeDeps {
    return {
      emitTo: (sid, evt) => this.emit(sid, evt),
      loadSdk: () => this.load(),
      ensureModelRuntime: () => this.init(),
      getModelRuntime: () => this.modelRuntime,
      getAvailability: () => this.getAvailability(),
      resolveModel: (pid) => this.resolveModel(pid),
      getTaskCwd: (taskId) => {
        const t = configStore.getTask(taskId);
        return t ? getTaskCwd(t) : "";
      },
      getTask: (taskId) => configStore.getTask(taskId),
      getTeam: (id) => teamStore.get(id),
      findExpert: (id) => findExpert(id),
    };
  }

  /** 任务是否绑定 workflow 团队（此类任务不建 AgentSession，运行走 agent:run-workflow） */
  private isWorkflowTask(taskId: string): boolean {
    const task = configStore.getTask(taskId);
    if (!task?.teamId) return false;
    return teamStore.get(task.teamId)?.routingStrategy === "workflow";
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

  /** 为任务创建/恢复 AgentSession（会话配置装配见 sessionBuilder.buildSessionConfig） */
  async createTaskSession(task: TaskMeta, providerId?: string): Promise<void> {
    const sdk = await this.load();
    if (!this.modelRuntime) await this.init();
    // init 后 modelRuntime 必就绪（await 后 TS 窄化失效，此处显式断言一次）
    const modelRuntime = this.modelRuntime as ModelRuntime;

    const cwd = getTaskCwd(task);
    const sessionDir = task.sessionDir;
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

    // 团队绑定：auto 团队 → 主 agent 人格 + 委派指令 + delegate 工具；workflow 团队 → 不建会话（运行走 agent:run-workflow）
    let extraTools: ToolDefinition[] = [];
    let extraToolNames: string[] = [];
    let appendPromptOverride: string[] | undefined;
    let expert: Expert | undefined = task.expertId ? findExpert(task.expertId) : undefined;
    if (task.teamId) {
      const team = teamStore.get(task.teamId);
      if (team?.routingStrategy === "auto") {
        // 协调者 = 主 agent（leadExpertId ?? 首成员）；成员为可委派对象（不含主 agent）
        const coordinatorId = teamRuntime.coordinatorExpertId(team);
        const coordinator = coordinatorId ? findExpert(coordinatorId) : undefined;
        const members = team.expertIds
          .filter((id) => id !== coordinatorId)
          .map((id) => findExpert(id))
          .filter((e): e is Expert => !!e);
        extraTools = await teamRuntime.buildDelegateTools(team, { parentTaskId: task.id, cwd });
        extraToolNames = extraTools.map((t) => t.name);
        expert = coordinator; // 主 agent 人格（无则回退 undefined → 模式默认）
        appendPromptOverride = teamRuntime.buildCoordinatorInstructions(team, members);
      } else if (team?.routingStrategy === "workflow") {
        return;
      }
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

    const built = await buildSessionConfig({
      sdk,
      modelRuntime,
      availability: this.getAvailability(),
      cwd,
      mode: task.mode ?? "daily",
      expert,
      providerId,
      emit: (evt) => this.emit(task.id, evt),
      getMode: () => this.getTaskMode(task.id),
      resolveModel: (pid) => this.resolveModel(pid),
      extraTools,
      extraToolNames,
      appendPromptOverride,
    });

    const { session } = await sdk.createAgentSession({
      cwd,
      model: built.model,
      modelRuntime,
      sessionManager,
      tools: built.toolAllowlist,
      customTools: built.customTools,
      resourceLoader: built.resourceLoader,
    });

    // 多次转向合并：steeringMode "all" 把同一时刻排队的多条转向消息一起注入、
    // 合并为一个响应（默认 one-at-a-time 会各自产生一个 turn）；持久化到 SDK settings
    session.setSteeringMode("all");

    const unsubscribe = session.subscribe((event: unknown) => {
      this.translateAndEmit(task.id, event);
    });

    this.sessions.set(task.id, { session, unsubscribe, controllers: built.controllers });
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
      this.emitError(taskId, "errors.noWorkDir");
      return null;
    }
    try {
      const staged = await stageAttachments(attachments, cwd);
      const copied = staged.filter((s) => !s.skipped);
      if (copied.length === 0) {
        this.emitError(
          taskId,
          uiError("errors.stageFailed", { detail: staged[0]?.error ?? "" }).message,
        );
        return null;
      }

      // 原生 agent 模式：不预分析图片、不注入描述，由 agent 自主决定——
      // 视觉模型可直接看到裸图；非视觉模型经 manifest 提示用内置 understand_image 工具理解（真实工具卡可见）
      const providerIdEffective = providerId ?? task.providerId;
      const currentModel = providerIdEffective ? this.resolveModel(providerIdEffective) : undefined;
      const supportsVision = Boolean(currentModel?.input?.includes("image"));
      const manifest = buildManifestText(staged, {
        imageHint: supportsVision
          ? undefined
          : "当前模型不支持视觉，图片请用 understand_image 工具调用视觉模型理解",
      });

      return text.trim() ? `${text}\n\n${manifest}` : manifest;
    } catch (err) {
      this.emitError(
        taskId,
        uiError("errors.attachmentFailed", {
          message: err instanceof Error ? err.message : String(err),
        }).message,
      );
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
    // workflow 团队任务不建 AgentSession：首条（及后续）消息直接运行工作流
    if (this.isWorkflowTask(taskId)) {
      const task = configStore.getTask(taskId);
      if (task?.teamId) {
        await teamRuntime.runWorkflow(taskId, task.teamId, text, providerId ?? task.providerId);
      } else {
        this.emitError(taskId, "该任务绑定工作流团队，请运行工作流");
      }
      return;
    }
    const state = this.sessions.get(taskId);
    if (!state) {
      // 会话未就绪（竞态或初始化失败）：经事件流报错，避免 IPC reject 变成未处理异常
      this.emitError(taskId, "errors.sessionNotReady");
      return;
    }

    if (!(await this.resolveAndSetModel(taskId, state, providerId))) return;
    const fullText = await this.buildPromptText(taskId, text, providerId, attachments);
    if (fullText === null) return;

    try {
      await state.session.prompt(fullText);
    } catch (err) {
      this.emitError(
        taskId,
        uiError("errors.sendFailed", { message: err instanceof Error ? err.message : String(err) })
          .message,
      );
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
    // workflow 团队任务不建 AgentSession，运行走 agent:run-workflow
    if (this.isWorkflowTask(taskId)) {
      this.emitError(taskId, "该任务绑定工作流团队，请运行工作流");
      return;
    }
    const state = this.sessions.get(taskId);
    if (!state) {
      this.emitError(taskId, "errors.sessionNotReady");
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
      this.emitError(
        taskId,
        uiError("errors.sendFailed", { message: err instanceof Error ? err.message : String(err) })
          .message,
      );
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
    // 团队在途子代理 / workflow 运行级联中止（父会话 abort 的 signal 会自行触发在途 delegate）
    teamRuntime.abortForTask(taskId);
    const state = this.sessions.get(taskId);
    if (!state) return;
    this.abortRequested.add(taskId);
    await state.session.abort();
  }

  /**
   * 手动压缩会话上下文（/compact，SDK session.compact）。
   * 阻塞至摘要生成完成（期间先中止当前 agent 操作）；错误以 { ok: false, error } 返回
   * （会话过小 / 已压缩过 / 无会话），由渲染层提示，不抛异常。
   * 压缩条目已写入会话 JSONL，渲染层压缩成功后应重载历史以呈现压缩边界摘要卡。
   */
  async compact(taskId: string, customInstructions?: string): Promise<CompactResult> {
    const state = this.sessions.get(taskId);
    if (!state) return { ok: false, error: "errors.sessionNotReady" };
    try {
      const result = await state.session.compact(customInstructions);
      return { ok: true, summary: result.summary };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
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
    const ctrl = state.controllers.permission as
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
    if (!task) throw uiError("errors.taskNotFound");
    const recentFile = findMostRecentSessionFile(task.sessionDir);
    if (!recentFile || !existsSync(recentFile)) {
      throw uiError("errors.noSessionForBranch");
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
    if (!newSessionFile) throw uiError("errors.branchNotPersisted");

    // 新任务：复制类型/模式/模型/空间，解析新 sessionDir（临时任务取新 workDir）
    const workspace = task.workspaceId ? configStore.getWorkspace(task.workspaceId) : undefined;
    const { sessionDir: newSessionDir, workDir } = resolveSessionLocation(task.type, workspace);
    const now = new Date().toISOString();
    const newTask: TaskMeta = {
      id: randomUUID(),
      title: `${task.title} · 分支`,
      type: task.type,
      mode: task.mode,
      expertId: task.expertId,
      teamId: task.teamId,
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
    // 团队在途子代理 / workflow 运行一并清理（兜底）
    teamRuntime.disposeForTask(taskId);
    const state = this.sessions.get(taskId);
    if (!state) return;
    // 先摘出，阻断后续 prompt 命中
    this.sessions.delete(taskId);
    // 未应答的工具权限按拒绝处理，避免工具永久阻塞
    (state.controllers.permission as { dispose?: () => void } | undefined)?.dispose?.();
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
