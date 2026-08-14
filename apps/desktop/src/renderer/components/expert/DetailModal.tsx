/**
 * DetailModal - 专家/专家团/技能/连接器 详情弹层（对齐 demo HTML：居中弹层 + 头部/主体/底部）。
 *
 * 内置专家只读（复制为自定义后编辑）；团队高级能力预留说明 + 流程图；
 * 技能 SKILL.md 编辑 + 启停；连接器 per-type 配置 + 测试连接 + 绑定专家。
 */

import type {
  Connector,
  ConnectorType,
  Expert,
  ExpertTeam,
  SkillEntry,
} from "@everybuddy/ipc-contract";
import { useEffect, useState } from "react";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import {
  IconBot,
  IconCheck,
  IconClipboard,
  IconClose,
  IconInfo,
  IconMonitor,
  IconPalette,
  IconPlus,
  IconWarn,
} from "./icons";
import {
  btnDanger,
  btnGhost,
  btnPrimary,
  ChipRemovable,
  expertIcon,
  Field,
  IconTile,
  type IconTone,
  Note,
  Select,
  SourceBadge,
  STATUS_LABEL,
  StatusDot,
  Switch,
  Tag,
  TextArea,
  TextInput,
  TypeBadge,
} from "./ui";

type TabId = "expert" | "team" | "skill" | "connector";

export function DetailModal({
  kind,
  id,
  onClose,
}: {
  kind: TabId;
  id: string;
  onClose: () => void;
}) {
  const store = useExpertCenterStore();
  const [currentId, setCurrentId] = useState(id);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // 团队预留能力占位卡（res-bot / res-workflow）
  if (currentId.startsWith("res-")) {
    return <ReservedModal kind={currentId.slice(4)} onClose={onClose} />;
  }

  const expert = kind === "expert" ? store.experts.find((e) => e.id === currentId) : undefined;
  const team = kind === "team" ? store.teams.find((t) => t.id === currentId) : undefined;
  const skill = kind === "skill" ? store.skills.find((s) => s.id === currentId) : undefined;
  const connector =
    kind === "connector" ? store.connectors.find((c) => c.id === currentId) : undefined;

  const body = expert ? (
    <ExpertForm
      key={expert.id}
      expert={expert}
      onCopy={(newId) => setCurrentId(newId)}
      onClose={onClose}
    />
  ) : team ? (
    <TeamForm key={team.id} team={team} onClose={onClose} />
  ) : skill ? (
    <SkillForm key={skill.id} skill={skill} onClose={onClose} />
  ) : connector ? (
    <ConnectorForm key={connector.id} connector={connector} onClose={onClose} />
  ) : null;

  if (!body) return null;

  return <ModalShell onClose={onClose}>{body}</ModalShell>;
}

/** 弹层骨架：遮罩（点击关闭）+ 居中面板 + 关闭按钮 */
export function ModalShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 遮罩点击关闭是 Modal 通用模式，键盘侧由 Escape 处理
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,28,24,0.35)] p-[28px] backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-[640px] flex-col overflow-hidden rounded-[18px] bg-card shadow-modal">
        {children}
      </div>
    </div>
  );
}

function ModalHead({
  icon,
  tone,
  title,
  sub,
  badges,
  onClose,
}: {
  icon: string;
  tone: IconTone;
  title: React.ReactNode;
  sub: string;
  badges?: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-[14px] border-b border-line px-[24px] py-[20px]">
      <IconTile icon={expertIcon(icon)} tone={tone} size="xl" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-[8px] text-[20px] font-bold text-ink">
          {title}
          {badges}
        </div>
        <div className="mt-[3px] text-[14px] text-ink-2">{sub}</div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition hover:bg-hover hover:text-ink"
      >
        <IconClose size={18} />
      </button>
    </div>
  );
}

function ModalFoot({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-[10px] border-t border-line bg-paper px-[24px] py-[14px]">
      {children}
    </div>
  );
}

/* ════════════ 专家 ════════════ */

function ExpertForm({
  expert,
  onCopy,
  onClose,
}: {
  expert: Expert;
  onCopy: (id: string) => void;
  onClose: () => void;
}) {
  const store = useExpertCenterStore();
  const builtin = expert.source === "builtin";
  const [name, setName] = useState(expert.name);
  const [description, setDescription] = useState(expert.description);
  const [mode, setMode] = useState(expert.mode);
  const [systemPrompt, setSystemPrompt] = useState(expert.systemPrompt ?? "");
  const [tools, setTools] = useState<string[]>(expert.tools ?? []);
  const [extensions, setExtensions] = useState<string[]>(expert.extensions ?? []);
  const [tags, setTags] = useState<string[]>(expert.tags ?? []);
  const [defaultModel, setDefaultModel] = useState(expert.defaultModelProviderId ?? "");
  const [visionModel, setVisionModel] = useState(expert.visionModelProviderId ?? "");
  const [imageModel, setImageModel] = useState(expert.imageGenModelProviderId ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await store.updateExpert({
        id: expert.id,
        name,
        description,
        mode,
        systemPrompt: systemPrompt || undefined,
        tools,
        extensions,
        tags,
        defaultModelProviderId: defaultModel || null,
        visionModelProviderId: visionModel || null,
        imageGenModelProviderId: imageModel || null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const copyAsCustom = async () => {
    const created = await store.createExpert({
      name: `${expert.name}（副本）`,
      icon: expert.icon,
      description: expert.description,
      mode: expert.mode,
      systemPrompt: expert.systemPrompt,
      appendSystemPrompt: expert.appendSystemPrompt,
      tools: expert.tools,
      extensions: expert.extensions,
      defaultModelProviderId: expert.defaultModelProviderId,
      visionModelProviderId: expert.visionModelProviderId,
      imageGenModelProviderId: expert.imageGenModelProviderId,
      tags: expert.tags,
    });
    onCopy(created.id);
  };

  const remove = async () => {
    await store.deleteExpert(expert.id);
    onClose();
  };

  return (
    <>
      <ModalHead
        icon={expert.icon}
        tone={builtin ? "accent" : "purple"}
        title={expert.name}
        sub={expert.description}
        badges={<SourceBadge source={expert.source} />}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
        {builtin ? (
          <div className="mb-[4px]">
            <Note tone="info" icon={<IconInfo size={18} />} title="内置专家：仅展示">
              编辑会基于当前模式配置，请「复制为自定义」后修改，避免与 agent 配置漂移。
            </Note>
          </div>
        ) : null}
        <Field label="名称">
          <TextInput value={name} onChange={setName} disabled={builtin} />
        </Field>
        <Field label="描述">
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        <Field label="基准模式">
          <Select
            value={mode}
            onChange={(v) => setMode(v as Expert["mode"])}
            options={[
              { value: "daily", label: "daily 日常办公" },
              { value: "coding", label: "coding 代码开发" },
            ]}
          />
        </Field>
        <Field
          label="系统提示词（systemPrompt）"
          hint="缺省由 main/prompts/*.ts builder 生成；自定义专家可覆盖。"
        >
          <TextArea value={systemPrompt} onChange={setSystemPrompt} rows={4} mono />
        </Field>
        <Field label="工具 allowlist 追加（tools）">
          <EditableTags value={tools} onChange={setTools} placeholder="如 understand_image" />
        </Field>
        <Field label="启用的扩展（extensions）">
          <EditableTags value={extensions} onChange={setExtensions} placeholder="如 plan-mode" />
        </Field>
        <Field label="模型 provider（可留空跟随模式默认）">
          <div className="grid grid-cols-3 gap-[12px]">
            <div>
              <div className="mb-[6px] text-[12px] font-semibold text-ink-3">默认</div>
              <TextInput value={defaultModel} onChange={setDefaultModel} placeholder="缺省" />
            </div>
            <div>
              <div className="mb-[6px] text-[12px] font-semibold text-ink-3">视觉</div>
              <TextInput value={visionModel} onChange={setVisionModel} placeholder="缺省" />
            </div>
            <div>
              <div className="mb-[6px] text-[12px] font-semibold text-ink-3">生图</div>
              <TextInput value={imageModel} onChange={setImageModel} placeholder="缺省" />
            </div>
          </div>
        </Field>
        <Field label="标签" hint="预留命名空间：domain:* / capability:* / source:* / team:*">
          <EditableTags value={tags} onChange={setTags} placeholder="domain:office" />
        </Field>
      </div>
      <ModalFoot>
        {builtin ? (
          <button type="button" onClick={() => void copyAsCustom()} className={btnPrimary}>
            <IconPlus size={16} />
            复制为自定义
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className={btnPrimary}
            >
              保存
            </button>
            <button type="button" onClick={() => void remove()} className={btnDanger}>
              删除
            </button>
          </>
        )}
        <button type="button" onClick={onClose} className={btnGhost}>
          关闭
        </button>
      </ModalFoot>
    </>
  );
}

/* ════════════ 专家团 ════════════ */

function TeamForm({ team, onClose }: { team: ExpertTeam; onClose: () => void }) {
  const store = useExpertCenterStore();
  const [expertIds, setExpertIds] = useState<string[]>(team.expertIds);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await store.updateTeam({ id: team.id, expertIds });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await store.deleteTeam(team.id);
    onClose();
  };

  return (
    <>
      <ModalHead
        icon={team.icon}
        tone="accent"
        title={team.name}
        sub={`${team.description} · 成员 ${team.expertIds.length} 人`}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
        <Field label="团队成员（手动切换专家）" hint="同一任务内可在这些专家间一键切换人格。">
          <div className="grid grid-cols-2 gap-[9px]">
            {store.experts.map((e) => {
              const on = expertIds.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() =>
                    setExpertIds((prev) => (on ? prev.filter((x) => x !== e.id) : [...prev, e.id]))
                  }
                  className={`flex items-center gap-[10px] rounded-[10px] border p-[10px] px-[12px] text-left transition ${
                    on ? "border-accent-line bg-accent-tint" : "border-line bg-card hover:bg-hover"
                  }`}
                >
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition ${
                      on ? "border-accent bg-accent text-white" : "border-line-strong"
                    }`}
                  >
                    {on ? <IconCheck size={13} strokeWidth={2.5} /> : null}
                  </span>
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-accent-tint text-accent">
                    {expertIcon(e.icon)}
                  </span>
                  <span className="truncate text-[15px] font-medium">{e.name}</span>
                </button>
              );
            })}
          </div>
        </Field>
        <div className="mt-[20px]">
          <Note tone="warn" icon={<IconWarn size={18} />} title="专家团高级能力预留中。">
            规划支持 Agent 团队形式调动子 Agent（主 Agent 分派任务给子 Agent 并汇总），以及 Agent
            Workflow 编排（可视化节点编排多 Agent
            流程）。当前先落地专家与技能，团队高级能力后续实现，字段已预留。
          </Note>
        </div>
        <div className="mt-[20px] flex items-center justify-center gap-0">
          <FlowNode icon={<IconBot />} name="主 Agent" lead />
          <span className="px-[6px] text-[18px] text-ink-3">→</span>
          <FlowNode icon={<IconClipboard />} name="子 Agent" />
          <span className="px-[6px] text-[18px] text-ink-3">→</span>
          <FlowNode icon={<IconPalette />} name="子 Agent" />
          <span className="px-[6px] text-[18px] text-ink-3">→</span>
          <FlowNode icon={<IconBot />} name="汇总" lead />
        </div>
      </div>
      <ModalFoot>
        <button type="button" onClick={() => void save()} disabled={busy} className={btnPrimary}>
          保存成员
        </button>
        <button type="button" onClick={() => void remove()} className={btnDanger}>
          删除
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          关闭
        </button>
      </ModalFoot>
    </>
  );
}

function FlowNode({
  icon,
  name,
  lead = false,
}: {
  icon: React.ReactNode;
  name: string;
  lead?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[92px] flex-col items-center gap-[6px] rounded-[12px] border p-[14px] px-[16px] ${
        lead ? "border-accent-line bg-accent-tint" : "border-line bg-paper"
      }`}
    >
      <span className={lead ? "text-accent" : "text-ink-2"}>{icon}</span>
      <span className={`text-[13px] font-semibold ${lead ? "text-accent-strong" : "text-ink-2"}`}>
        {name}
      </span>
    </div>
  );
}

/* ════════════ 技能 ════════════ */

function SkillForm({ skill, onClose }: { skill: SkillEntry; onClose: () => void }) {
  const store = useExpertCenterStore();
  const [description, setDescription] = useState(skill.description);
  const [content, setContent] = useState("");
  const [enabled, setEnabled] = useState(skill.enabled);
  const [tags, setTags] = useState<string[]>(skill.tags ?? []);
  const [busy, setBusy] = useState(false);

  // 经 workspace:readFile 读取 SKILL.md 正文（复用现有读文件通道）
  useEffect(() => {
    let cancelled = false;
    window.electronAPI.workspace
      .readFile(skill.filePath)
      .then((r) => {
        if (!cancelled && r.kind === "text") setContent(r.text);
      })
      .catch(() => {
        /* 读失败保持空，保存时不覆盖正文 */
      });
    return () => {
      cancelled = true;
    };
  }, [skill.filePath]);

  const toggleEnabled = async (v: boolean) => {
    setEnabled(v);
    await store.enableSkill(skill.id, v);
  };

  const save = async () => {
    setBusy(true);
    try {
      await store.updateSkill({
        id: skill.id,
        description,
        // 仅正文已加载或用户编辑过才写入，避免空值覆盖已有 SKILL.md
        content: content.length > 0 ? content : undefined,
        tags,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const uninstall = async () => {
    await store.uninstallSkill(skill.id);
    onClose();
  };

  return (
    <>
      <ModalHead
        icon="sparkles"
        tone="warn"
        title={`/${skill.name}`}
        sub={skill.description}
        badges={<SourceBadge source={skill.source} />}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
        <Field label="启用状态">
          <div className="flex items-center gap-[10px]">
            <Switch on={enabled} onChange={(v) => void toggleEnabled(v)} />
            <span className="text-[15px] text-ink-2">
              {enabled ? "已启用（注入 system prompt，可 /调用）" : "已停用"}
            </span>
          </div>
        </Field>
        <Field label="描述">
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        <Field label="SKILL.md 正文" hint="编辑后保存会更新技能包文件，/调用即按此指令执行。">
          <TextArea value={content} onChange={setContent} rows={9} mono />
        </Field>
        <Field label="标签">
          <EditableTags value={tags} onChange={setTags} placeholder="domain:product" />
        </Field>
      </div>
      <ModalFoot>
        <button type="button" onClick={() => void save()} disabled={busy} className={btnPrimary}>
          保存
        </button>
        {skill.source === "builtin" ? (
          <button type="button" disabled className={`${btnGhost} cursor-not-allowed opacity-40`}>
            内置不可卸载
          </button>
        ) : (
          <button type="button" onClick={() => void uninstall()} className={btnDanger}>
            卸载
          </button>
        )}
        <button type="button" onClick={onClose} className={btnGhost}>
          关闭
        </button>
      </ModalFoot>
    </>
  );
}

/* ════════════ 连接器 ════════════ */

const TYPE_OPTIONS: Array<{ id: ConnectorType; label: string }> = [
  { id: "mcp", label: "MCP Server" },
  { id: "filesystem", label: "文件系统" },
  { id: "http-api", label: "HTTP API" },
  { id: "datasource", label: "数据源" },
  { id: "custom", label: "自定义" },
];

const AVAILABLE_TYPES = new Set<ConnectorType>(["mcp", "filesystem"]);

function ConnectorForm({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const store = useExpertCenterStore();
  const [name, setName] = useState(connector.name);
  const [description, setDescription] = useState(connector.description);
  const [config, setConfig] = useState<Record<string, unknown>>(connector.config ?? {});
  const [bound, setBound] = useState<string[]>(connector.boundExpertIds);
  const [enabled, setEnabled] = useState(connector.enabled);
  const [capabilities, setCapabilities] = useState<string[]>(connector.capabilities);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const status = connector.status;

  const setCfg = (key: string, value: unknown) => setConfig((c) => ({ ...c, [key]: value }));

  const test = async () => {
    const r = await store.testConnector(connector.id);
    setTestMsg(r.message);
  };

  const save = async () => {
    setBusy(true);
    try {
      // 清理与当前类型/传输无关的 config 字段，避免残留脏配置
      const clean = { ...config };
      if (connector.type === "mcp" && clean.transport === "streamable-http") {
        delete clean.command;
        delete clean.args;
        delete clean.package;
        delete clean.version;
        delete clean.env;
      } else if (connector.type === "mcp") {
        delete clean.url;
        delete clean.headers;
      }
      await store.updateConnector({
        id: connector.id,
        name,
        description,
        config: clean,
        boundExpertIds: bound,
        enabled,
        capabilities,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await store.deleteConnector(connector.id);
    onClose();
  };

  const typeLabel = TYPE_OPTIONS.find((t) => t.id === connector.type)?.label ?? connector.type;

  return (
    <>
      <ModalHead
        icon={connector.icon}
        tone="info"
        title={
          <>
            {connector.name}
            <span className="ml-[4px] inline-flex items-center gap-[6px] text-[12px] font-semibold">
              <StatusDot status={status} label={STATUS_LABEL[status] ?? status} />
            </span>
          </>
        }
        sub={connector.description}
        badges={<TypeBadge label={typeLabel} />}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
        {status === "reserved" ? (
          <Note tone="warn" icon={<IconWarn size={18} />} title="已注册，运行时接入即将推出。">
            当前连接器已登记并打标签，尚未注入 agent。按类型分期激活：MCP / 文件系统已可用， HTTP
            API / 数据源开发中。激活时零迁移。
          </Note>
        ) : status === "connected" ? (
          <Note tone="info" icon={<IconInfo size={18} />} title="已接入。">
            启用的连接器能力会注入绑定的专家（MCP 工具作为 customTools），绑定关系即时生效。
          </Note>
        ) : null}
        {testMsg ? (
          <div className="mt-[12px] rounded-[10px] border border-line bg-paper px-[14px] py-[10px] text-[13px] text-ink-2">
            测试：{testMsg}
          </div>
        ) : null}
        {connector.lastTools && connector.lastTools.length > 0 ? (
          <div className="mt-[12px]">
            <div className="mb-[6px] text-[12px] font-semibold tracking-[0.04em] text-ink-2">
              已探测工具（{connector.lastTools.length}）
            </div>
            <div className="flex max-h-[96px] flex-wrap gap-[5px] overflow-y-auto">
              {connector.lastTools.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </div>
        ) : null}

        <Field label="名称">
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="描述">
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>

        <Field label="类型（开放枚举，未来扩展不改 schema）">
          <div className="grid grid-cols-5 gap-[8px]">
            {TYPE_OPTIONS.map((t) => {
              const active = connector.type === t.id;
              const available = AVAILABLE_TYPES.has(t.id);
              return (
                <div
                  key={t.id}
                  className={`flex flex-col items-center gap-[6px] rounded-[10px] border p-[10px] text-center ${
                    active ? "border-accent bg-accent-tint" : "border-line bg-card"
                  } ${!available ? "opacity-55" : ""}`}
                >
                  <div
                    className={`flex h-[34px] w-[34px] items-center justify-center rounded-[9px] ${
                      active ? "bg-card text-accent" : "bg-hover text-ink-2"
                    }`}
                  >
                    {expertIcon(
                      t.id === "mcp"
                        ? "hub"
                        : t.id === "filesystem"
                          ? "folder"
                          : t.id === "http-api"
                            ? "globe"
                            : t.id === "datasource"
                              ? "database"
                              : "puzzle",
                    )}
                  </div>
                  <div className="text-[12px] font-semibold text-ink">{t.label}</div>
                  <div
                    className={`text-[11px] font-semibold ${available ? "text-accent" : "text-ink-3"}`}
                  >
                    {available ? "可用" : "即将推出"}
                  </div>
                </div>
              );
            })}
          </div>
        </Field>

        <Field label="配置（config · 按 type 校验）">
          {connector.type === "mcp" ? (
            <McpConfigForm config={config} replaceConfig={(c) => setConfig(c)} />
          ) : connector.type === "filesystem" ? (
            <div className="grid grid-cols-[140px_1fr] items-center gap-[14px]">
              <span className="text-[14px] text-ink-2">白名单根目录</span>
              <TextInput
                value={String(config.rootDir ?? "")}
                onChange={(v) => setCfg("rootDir", v)}
                placeholder="/Users/me/project"
              />
            </div>
          ) : connector.type === "http-api" ? (
            <>
              <div className="mb-[12px] grid grid-cols-[140px_1fr] items-center gap-[14px]">
                <span className="text-[14px] text-ink-2">Endpoint</span>
                <TextInput
                  value={String(config.endpoint ?? "")}
                  onChange={(v) => setCfg("endpoint", v)}
                  placeholder="https://kb.internal/api"
                />
              </div>
              <div className="grid grid-cols-[140px_1fr] items-center gap-[14px]">
                <span className="text-[14px] text-ink-2">鉴权</span>
                <TextInput
                  value={String(config.auth ?? "")}
                  onChange={(v) => setCfg("auth", v)}
                  placeholder="Bearer ***"
                />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-ink-3">
              {connector.type} 类型仅注册，运行时注入后续实现；配置为自由 JSON。
            </p>
          )}
        </Field>

        <Field
          label="能力声明（capabilities · 预留）"
          hint="未来按 capability 决定注入方式：tools→customTools，context→system prompt，knowledge→检索增强。"
        >
          <div className="flex flex-wrap gap-[7px]">
            {["tools", "context", "knowledge", "actions"].map((cap) => {
              const on = capabilities.includes(cap);
              return on ? (
                <ChipRemovable
                  key={cap}
                  onRemove={() => setCapabilities((p) => p.filter((x) => x !== cap))}
                >
                  {cap}
                </ChipRemovable>
              ) : (
                <button
                  key={cap}
                  type="button"
                  onClick={() => setCapabilities((p) => [...p, cap])}
                  className="rounded-full border border-line bg-hover px-[10px] py-[4px] text-[13px] text-ink-3 transition hover:bg-active hover:text-ink-2"
                >
                  + {cap}
                </button>
              );
            })}
          </div>
        </Field>

        <Field
          label="绑定专家（boundExpertIds）"
          hint="声明哪些专家可用此连接器；MCP 启用时其工具注入这些专家。"
        >
          <div className="grid grid-cols-2 gap-[9px]">
            {store.experts.map((e) => {
              const on = bound.includes(e.id);
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setBound((p) => (on ? p.filter((x) => x !== e.id) : [...p, e.id]))}
                  className={`flex items-center gap-[10px] rounded-[10px] border p-[10px] px-[12px] text-left transition ${
                    on ? "border-accent-line bg-accent-tint" : "border-line bg-card hover:bg-hover"
                  }`}
                >
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition ${
                      on ? "border-accent bg-accent text-white" : "border-line-strong"
                    }`}
                  >
                    {on ? <IconCheck size={13} strokeWidth={2.5} /> : null}
                  </span>
                  <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-accent-tint text-accent">
                    {expertIcon(e.icon)}
                  </span>
                  <span className="truncate text-[15px] font-medium">{e.name}</span>
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="启用">
          <div className="flex items-center gap-[10px]">
            <Switch on={enabled} onChange={setEnabled} />
            <span className="text-[15px] text-ink-2">{enabled ? "启用中" : "已停用"}</span>
          </div>
        </Field>
      </div>
      <ModalFoot>
        <button type="button" onClick={() => void test()} className={btnGhost}>
          测试连接
        </button>
        <button type="button" onClick={() => void save()} disabled={busy} className={btnPrimary}>
          保存
        </button>
        <button type="button" onClick={() => void remove()} className={btnDanger}>
          删除
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          关闭
        </button>
      </ModalFoot>
    </>
  );
}

/* ════════════ MCP 配置表单（stdio / streamable-http 双传输，JSON 编辑） ════════════ */

/** 序列化 config（不含 transport），用于 JSON 编辑器初值 */
function serializeMcpJson(config: Record<string, unknown>): string {
  const { transport: _t, ...rest } = config;
  return JSON.stringify(rest, null, 2);
}

function McpConfigForm({
  config,
  replaceConfig,
}: {
  config: Record<string, unknown>;
  replaceConfig: (c: Record<string, unknown>) => void;
}) {
  const transport = String(config.transport ?? "stdio");
  const [json, setJson] = useState(() => serializeMcpJson(config));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // config 变化时同步编辑器内容（输入过程中 config 不变，不打断打字；transport 切换会改变 config）
  useEffect(() => {
    setJson(serializeMcpJson(config));
    setJsonError(null);
  }, [config]);

  const setTransport = (t: string) => replaceConfig({ ...config, transport: t });

  /** blur 提交：解析 JSON 并入 config（保留 transport） */
  const commit = () => {
    const raw = json.trim();
    if (!raw) {
      replaceConfig({ ...config, transport });
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        replaceConfig({ ...(parsed as Record<string, unknown>), transport });
        setJsonError(null);
      } else {
        setJsonError("配置需为 JSON 对象");
      }
    } catch {
      setJsonError("JSON 格式错误，请检查");
    }
  };

  const applyTemplate = () => {
    const tmpl =
      transport === "streamable-http"
        ? { url: "", headers: { Authorization: "Bearer xxx" } }
        : { package: "@modelcontextprotocol/server-xxx", version: "", env: {} };
    setJson(JSON.stringify(tmpl, null, 2));
    setJsonError(null);
  };

  const transportBtn = (id: string, label: string) => (
    <button
      type="button"
      onClick={() => setTransport(id)}
      className={`rounded-[8px] border px-[12px] py-[9px] text-[13.5px] font-semibold transition ${
        transport === id
          ? "border-accent bg-accent-tint text-accent-strong"
          : "border-line bg-card text-ink-2 hover:bg-hover"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div className="mb-[12px] grid grid-cols-2 gap-[8px]">
        {transportBtn("stdio", "STDIO · 本地进程")}
        {transportBtn("streamable-http", "Streamable HTTP · 远程")}
      </div>
      <div className="mb-[6px] flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-ink-2">MCP server 配置（JSON）</span>
        <button
          type="button"
          onClick={applyTemplate}
          className="text-[12px] font-semibold text-accent transition hover:underline"
        >
          填入模板
        </button>
      </div>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        onBlur={commit}
        rows={7}
        spellCheck={false}
        placeholder={
          transport === "streamable-http"
            ? '{ "url": "https://...", "headers": {} }'
            : '{ "package": "@modelcontextprotocol/server-xxx", "version": "", "env": {} }'
        }
        className="w-full rounded-[10px] border border-line bg-card px-[14px] py-[10px] font-mono text-[12.5px] leading-[1.6] text-ink shadow-card transition focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint"
      />
      {jsonError ? <p className="mt-[6px] text-[12.5px] text-danger">{jsonError}</p> : null}
      <p className="mt-[6px] text-[12.5px] leading-[1.6] text-ink-3">
        {transport === "streamable-http"
          ? "Streamable HTTP：url 必填，headers 可选（如 Authorization）。"
          : "托管安装：package 必填、version 可选；自定义命令：command + args；环境变量用 env（KEY=VALUE）。"}
      </p>
    </>
  );
}

/* ════════════ 预留能力弹层（团队 tab 的占位卡） ════════════ */

function ReservedModal({ kind, onClose }: { kind: string; onClose: () => void }) {
  const isBot = kind === "bot";
  const title = isBot ? "子 Agent 调度" : "Workflow 编排";
  const desc = isBot
    ? "主 Agent 调动子 Agent 协作：分派子任务、并行执行、汇总结果。"
    : "可视化节点编排多 Agent 流程：需求分析 → 设计 → 编码 → 评审 的有向图执行。";
  const icon = isBot ? "bot" : "workflow";
  return (
    <>
      <ModalHead
        icon={icon}
        tone="neutral"
        title={title}
        sub={desc}
        badges={
          <span className="rounded-[6px] bg-active px-[8px] py-[2px] text-[11px] font-semibold text-ink-2">
            预留
          </span>
        }
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
        <Note tone="warn" icon={<IconWarn size={18} />} title="该能力预留中，后续实现。">
          专家团本轮仅落地「成员登记 + 手动切换」。Agent 团队调度与 Workflow 编排为后续演进方向，
          schema 字段已预留，激活时零迁移。
        </Note>
        <div className="mt-[20px] flex items-center justify-center">
          <FlowNode icon={<IconBot />} name="主 Agent" lead />
          <span className="px-[6px] text-[18px] text-ink-3">→</span>
          <FlowNode icon={<IconClipboard />} name="子 Agent" />
          <span className="px-[6px] text-[18px] text-ink-3">→</span>
          <FlowNode icon={<IconMonitor />} name="子 Agent" />
          <span className="px-[6px] text-[18px] text-ink-3">→</span>
          <FlowNode icon={<IconBot />} name="汇总" lead />
        </div>
      </div>
      <ModalFoot>
        <button type="button" onClick={onClose} className={btnGhost}>
          关闭
        </button>
      </ModalFoot>
    </>
  );
}

/* ════════════ 可编辑 chips（增删字符串列表） ════════════ */

function EditableTags({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-[7px]">
      {value.map((t) => (
        <ChipRemovable key={t} onRemove={() => onChange(value.filter((x) => x !== t))}>
          {t}
        </ChipRemovable>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
        placeholder={placeholder ?? "添加…"}
        className="rounded-full border border-dashed border-line-strong px-[12px] py-[4px] text-[13px] text-ink-3 outline-none transition placeholder:text-ink-3 focus:border-accent-line focus:text-ink-2"
      />
    </div>
  );
}
