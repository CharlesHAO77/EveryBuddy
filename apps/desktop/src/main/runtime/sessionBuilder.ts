/**
 * sessionBuilder - 共享 Agent 会话构建器（单一真源，见 docs/architecture.md §5.1 与团队方案）。
 *
 * agentRuntime.createTaskSession（持久化任务会话）与 teamRuntime 的子代理引擎共用
 * buildSessionConfig：把「expert 配置 → 模型 → 工具 → 扩展 → allowlist → systemPrompt →
 * resourceLoader」的装配逻辑集中一处，避免两份平行实现。
 *  - 任务会话：调用方传持久化 SessionManager、父任务 emit/getMode。
 *  - headless 子会话：SessionManager.inMemory()、跳过 permission 门禁 + 默认扩展（plan-mode/todo）。
 *
 * 类型别名（CodingAgentSDK / ModelRuntime / PiModel / SessionManagerInstance / WithoutStreamId）
 * 也从这里导出，agentRuntime / teamRuntime 统一 import，不再各自声明。
 */

import path from "node:path";
import type {
  InlineExtension,
  ResourceDiagnostic,
  ResourceLoader,
  Skill,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AgentEvent, AgentMode, ExecutionMode, Expert } from "@everybuddy/ipc-contract";
import { type AgentConfig, getAgentConfig } from "../stores/agentConfigStore";
import { connectorStore } from "../stores/connectorStore";
import { uiError } from "../services/errors";
import { expertToAgentConfig } from "../stores/expertStore";
import { buildExtensionFactories, DEFAULT_EXTENSIONS } from "../extensions";
import { parseFileContent, resolveInUploads } from "../services/fileParser";
import { buildMcpTools } from "../services/mcpTools";
import {
  getApiKey,
  getImageGenModel,
  getProvider,
  getVisionModel,
  isChatModelProviderId,
} from "../stores/modelStore";
import { buildActiveToolsBlock, getModeSystemPrompt } from "../prompts";
import { skillStore } from "../stores/skillStore";
import { createFindOperations } from "../tools/findTool";
import { createGenerateImageToolDefinition } from "../tools/generateImageTool";
import { createGrepToolDefinition } from "../tools/grepTool";
import { buildRestrictedToolAllowlist, buildToolAllowlist } from "../tools/toolAllowlist";
import { buildToolPlan, type ToolAvailability } from "../tools/toolAvailability";
import { createUnderstandImageToolDefinition } from "../tools/understandImageTool";
import { type DescribeImageRuntime, describeImage } from "../services/vision";

// ────────────────────────────────────────────────
// 类型别名（编译期擦除；运行时通过动态 import() 加载 ESM 包）
// ────────────────────────────────────────────────

export type CodingAgentSDK = typeof import("@earendil-works/pi-coding-agent");
export type ModelRuntime = Awaited<ReturnType<CodingAgentSDK["ModelRuntime"]["create"]>>;
export type PiModel = NonNullable<ReturnType<ModelRuntime["getModel"]>>;
export type SessionManagerInstance = ReturnType<CodingAgentSDK["SessionManager"]["create"]>;
export type WithoutStreamId<T> = T extends { streamId: string } ? Omit<T, "streamId"> : T;

// ────────────────────────────────────────────────
// buildSessionConfig
// ────────────────────────────────────────────────

export interface BuildSessionConfigOptions {
  sdk: CodingAgentSDK;
  modelRuntime: ModelRuntime;
  /** 平台工具可用性机器级快照（bash 真实路径 / rg、fd 是否可用） */
  availability: ToolAvailability;
  cwd: string;
  mode: AgentMode;
  /** 已解析专家（叠加覆盖后）；缺省按 mode 回退内置 */
  expert?: Expert;
  /** 模型 provider 优先级：explicit → cfg.defaultModelProviderId → 第一个可对话模型 */
  providerId?: string;
  /** 扩展事件 emit 目标（父任务）；headless 子会话指向父任务 streamId */
  emit: (evt: WithoutStreamId<AgentEvent>) => void;
  /** 读取执行模式（供 permission 扩展实时读取）；headless 子会话恒 "auto" */
  getMode: () => ExecutionMode;
  resolveModel: (providerId: string) => PiModel | undefined;
  /** 额外自定义工具（团队 delegate 等）与对应 allowlist 条目，创建时并入 */
  extraTools?: ToolDefinition[];
  extraToolNames?: string[];
  /** headless 子会话：跳过 permission 门禁 + 默认扩展（plan-mode/todo） */
  headless?: boolean;
  /** 扩展名覆盖；headless 缺省 []，否则 cfg.extensions ?? 模式默认 */
  extensions?: string[];
  /** 覆盖 system prompt（coordinator / 自定义）；缺省 cfg.systemPrompt ?? 模式默认 builder */
  systemPromptOverride?: string;
  /** 覆盖 appendSystemPrompt（协调者委派指令等）；缺省 cfg.appendSystemPrompt */
  appendPromptOverride?: string[];
}

export interface SessionBuildResult {
  model: PiModel;
  cfg: AgentConfig;
  customTools: ToolDefinition[];
  toolAllowlist: string[];
  systemPrompt: string;
  resourceLoader: ResourceLoader;
  controllers: Record<string, unknown>;
  factories: InlineExtension[];
}

/**
 * 装配一次 Agent 会话的完整配置（模型/工具/扩展/allowlist/systemPrompt/resourceLoader）。
 * 会话 manager 无关——持久化与否由调用方在 createAgentSession 时决定。
 */
export async function buildSessionConfig(
  opts: BuildSessionConfigOptions,
): Promise<SessionBuildResult> {
  const { sdk, modelRuntime, availability, cwd, mode, emit, getMode, resolveModel } = opts;

  // 模式级配置 + expert 覆盖（builtin 专家无覆盖 → 等价基础配置，零行为变更）
  let cfg = getAgentConfig(mode);
  if (opts.expert) cfg = expertToAgentConfig(opts.expert, cfg);

  // 解析模型：调用方指定 → 配置默认 → 第一个可对话模型（每处过滤 image 专用 provider）
  let model: PiModel | undefined;
  if (opts.providerId && isChatModelProviderId(opts.providerId)) {
    model = resolveModel(opts.providerId);
  }
  if (!model && cfg.defaultModelProviderId && isChatModelProviderId(cfg.defaultModelProviderId)) {
    model = resolveModel(cfg.defaultModelProviderId);
  }
  if (!model) {
    const available = await modelRuntime.getAvailable();
    model = available?.find((m) => isChatModelProviderId(m.provider)) as PiModel | undefined;
  }
  if (!model) throw uiError("errors.noModelConfigured");

  // 视觉/生图 provider 实时解析：专家覆盖后的 agent 配置优先，其次能力标签
  const resolveVisionProviderId = (): string | undefined =>
    cfg.visionModelProviderId ?? getVisionModel();
  const resolveImageGenProviderId = (): string | undefined =>
    cfg.imageGenModelProviderId ?? getImageGenModel();

  // 平台化工具配置 + customTools 装配（bash Windows 真实 Git Bash 覆盖 / node grep/find 兜底）
  const plan = buildToolPlan(availability);
  const customTools: ToolDefinition[] = [await buildParseAttachmentTool(sdk, cwd)];
  if (plan.bashShellPath) {
    customTools.push(
      sdk.createBashToolDefinition(cwd, { shellPath: plan.bashShellPath }) as ToolDefinition,
    );
  }
  if (plan.useNodeFind) {
    customTools.push(
      sdk.createFindToolDefinition(cwd, { operations: createFindOperations() }) as ToolDefinition,
    );
  }
  if (plan.useNodeGrep) {
    customTools.push(await createGrepToolDefinition(cwd));
  }

  // 视觉理解 / 生图自定义工具（工具内部按需解析视觉/生图模型）
  customTools.push(
    await createUnderstandImageToolDefinition(cwd, {
      resolveVisionModel: () => {
        const pid = resolveVisionProviderId();
        return pid ? resolveModel(pid) : undefined;
      },
      describeImage: (model, image, question, signal) =>
        describeImage(
          modelRuntime as unknown as DescribeImageRuntime,
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
        return { providerId: pid, baseUrl: provider.baseUrl, model: provider.models[0]?.id ?? "" };
      },
      getApiKey,
    }),
  );

  // 连接器注入：status=connected + enabled 的 MCP 连接器 → 其工具并入 customTools
  const mcpConnectors = connectorStore
    .list()
    .filter((c) => c.type === "mcp" && c.enabled && c.status === "connected");
  for (const mcp of mcpConnectors) {
    customTools.push(...(await buildMcpTools(mcp)));
  }

  // 额外工具（团队 delegate 等）
  customTools.push(...(opts.extraTools ?? []));

  // 扩展：headless 子会话跳过 permission 门禁 + 默认扩展；任务会话沿用 cfg.extensions ?? 模式默认
  const extensions = opts.headless
    ? (opts.extensions ?? [])
    : (cfg.extensions ?? DEFAULT_EXTENSIONS[mode]);
  const {
    factories,
    controllers,
    tools: extTools,
  } = buildExtensionFactories(extensions, emit, { getMode }, { includePermission: !opts.headless });

  // tools allowlist 过滤所有工具（含 customTools / 扩展注册工具），必须显式并入。
  // 自定义专家显式选定工具 → 权威集合（空 = 精简）；否则平台全量 ∪ 配置/扩展/额外
  const baseTools = [...(cfg.tools ?? []), ...extTools, ...(opts.extraToolNames ?? [])];
  const toolAllowlist = cfg.restrictTools
    ? buildRestrictedToolAllowlist(baseTools)
    : buildToolAllowlist(plan.tools, baseTools);

  // 模式级 system prompt：systemPromptOverride（coordinator）→ cfg.systemPrompt → 模式默认 builder
  let systemPrompt =
    opts.systemPromptOverride ??
    cfg.systemPrompt ??
    getModeSystemPrompt(mode, { activeTools: toolAllowlist });
  // 自定义专家用身份提示词（不含工具清单）→ 显式附上可用工具 + "未列出不可用"约束，
  // 防止模型按通用认知臆测内置 read/bash/联网等能力
  if (opts.expert?.source === "custom") {
    systemPrompt = `${systemPrompt}\n\n${buildActiveToolsBlock(toolAllowlist)}`;
  }

  // 技能注入：把启用的 EveryBuddy 技能并入 SDK 自动发现的技能（skillsOverride 单一注入点）
  const managedSkills = skillStore.listEnabled();
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir: sdk.getAgentDir(),
    systemPrompt,
    appendSystemPrompt: opts.appendPromptOverride ?? cfg.appendSystemPrompt ?? undefined,
    extensionFactories: factories,
    ...(managedSkills.length > 0
      ? {
          skillsOverride: (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
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

  return {
    model,
    cfg,
    customTools,
    toolAllowlist,
    systemPrompt,
    resourceLoader,
    controllers,
    factories,
  };
}

/**
 * 构造 parse_attachment 自定义工具：让 Agent 按需解析 uploads/ 下的附件
 * （PDF/DOCX/XLSX/PPTX 等 read 工具读不了的二进制文档）。闭包捕获任务 cwd，
 * 路径经 resolveInUploads 严格限定在 uploads/ 内。
 */
export async function buildParseAttachmentTool(
  sdk: CodingAgentSDK,
  cwd: string,
): Promise<ReturnType<CodingAgentSDK["defineTool"]>> {
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
