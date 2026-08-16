/**
 * DetailModal - 专家/专家团/技能/连接器 详情弹层（对齐 demo HTML：居中弹层 + 头部/主体/底部）。
 *
 * 内置专家只读（复制为自定义后编辑）；团队高级能力预留说明 + 流程图；
 * 技能 SKILL.md 编辑 + 启停；连接器 per-type 配置 + 测试连接 + 绑定专家。
 */

import type {
  Connector,
  Expert,
  ExpertTeam,
  SkillEntry,
  TeamWorkflow,
  WorkflowStep,
} from "@everybuddy/ipc-contract";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateError } from "../../i18n/translateError";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import { IconCheck, IconClose, IconInfo, IconPlus, IconWarn } from "./icons";
import { ExtensionMultiSelect, ToolMultiSelect } from "./PickList";
import {
  AgentRoleRows,
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
  TeamStrategyBadge,
  TextArea,
  TextInput,
  TypeBadge,
  teamMemberCount,
} from "./ui";
import { WorkflowCanvas } from "./WorkflowCanvas";

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

  // 自定义 workflow 团队用加宽弹层容纳画布设计器
  const wide =
    kind === "team" && !!team && team.source !== "builtin" && team.routingStrategy === "workflow";

  return (
    <ModalShell onClose={onClose} wide={wide}>
      {body}
    </ModalShell>
  );
}

/** 弹层骨架：遮罩（点击关闭）+ 居中面板 + 关闭按钮；wide = 工作流画布用加宽弹层 */
export function ModalShell({
  onClose,
  children,
  wide = false,
}: {
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 遮罩点击关闭是 Modal 通用模式，键盘侧由 Escape 处理
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,28,24,0.35)] p-[28px] backdrop-blur-[3px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`flex max-h-[86vh] w-full flex-col overflow-hidden rounded-[18px] bg-card shadow-modal ${
          wide ? "max-w-[1200px]" : "max-w-[640px]"
        }`}
      >
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
  const { t } = useTranslation();
  const store = useExpertCenterStore();
  const builtin = expert.source === "builtin";
  const catalog = useExpertCenterStore((s) => s.catalog);
  // 已连接 MCP 工具（工具选择列表的「已连接 MCP 工具」分组）
  const mcpToolNames = useMemo(() => {
    const s = new Set<string>();
    for (const c of store.connectors) {
      if (c.type === "mcp" && c.enabled && c.status === "connected") {
        for (const t of c.lastTools ?? []) s.add(t);
      }
    }
    return [...s];
  }, [store.connectors]);
  // 模式默认工具/扩展（内置专家自动勾选，与运行时一致）
  const defaultTools = catalog?.defaultTools[expert.mode] ?? [];
  const defaultExts = catalog?.defaultExtensions[expert.mode] ?? [];
  const [name, setName] = useState(expert.name);
  const [description, setDescription] = useState(expert.description);
  const [systemPrompt, setSystemPrompt] = useState(expert.systemPrompt ?? "");
  const [appendPrompt, setAppendPrompt] = useState(expert.appendSystemPrompt?.join("\n") ?? "");
  // 内置专家：初始为模式默认 ∪ 覆盖，保证列表「自动勾选」当前生效工具/扩展
  const [tools, setTools] = useState<string[]>(
    builtin
      ? Array.from(new Set([...defaultTools, ...(expert.tools ?? [])]))
      : (expert.tools ?? []),
  );
  const [extensions, setExtensions] = useState<string[]>(
    builtin
      ? Array.from(new Set([...defaultExts, ...(expert.extensions ?? [])]))
      : (expert.extensions ?? []),
  );
  const [tags, setTags] = useState<string[]>(expert.tags ?? []);
  const [busy, setBusy] = useState(false);

  /** 模式默认系统提示词（main/prompts/*.ts builder），内置专家未覆盖时同步展示 */
  const defaultPrompt = catalog?.modePrompts[expert.mode] ?? "";
  /** 当前生效提示词：内置专家未自定义时 = 模式默认，保证与运行时一致 */
  const effectivePrompt = builtin ? systemPrompt || defaultPrompt : systemPrompt;

  /** 多行追加提示词 → string[]（空 → 清除） */
  const parseAppendLines = (raw: string): string[] => {
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  };

  const arraysEqual = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x, i) => x === b[i]);

  const save = async () => {
    setBusy(true);
    try {
      await store.updateExpert({
        id: expert.id,
        name,
        description,
        mode: expert.mode,
        // 内置专家：等于模式默认（未自定义）→ 空串/空数组清除覆盖，保持跟随模式默认
        systemPrompt:
          builtin && systemPrompt.trim() === defaultPrompt.trim() ? "" : systemPrompt || undefined,
        appendSystemPrompt: parseAppendLines(appendPrompt),
        tools: builtin && arraysEqual(tools, defaultTools) ? [] : tools,
        extensions: builtin && arraysEqual(extensions, defaultExts) ? [] : extensions,
        tags,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  /** 内置专家重置为默认：删除 override，回退 main/prompts 模式默认 */
  const resetToDefault = async () => {
    setBusy(true);
    try {
      const fresh = await store.resetExpert(expert.id);
      setName(fresh.name);
      setDescription(fresh.description);
      setSystemPrompt(fresh.systemPrompt ?? "");
      setAppendPrompt(fresh.appendSystemPrompt?.join("\n") ?? "");
      setTools(Array.from(new Set([...defaultTools, ...(fresh.tools ?? [])])));
      setExtensions(Array.from(new Set([...defaultExts, ...(fresh.extensions ?? [])])));
      setTags(fresh.tags ?? []);
    } finally {
      setBusy(false);
    }
  };

  const copyAsCustom = async () => {
    const created = await store.createExpert({
      name: `${expert.name}${t("expert.copySuffix")}`,
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
        <Field label={t("expert.form.nameLabel")}>
          <TextInput value={name} onChange={setName} disabled={builtin} />
        </Field>
        <Field label={t("expert.form.descriptionLabel")}>
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        <Field
          label={t("expert.form.systemPromptLabel")}
          hint={
            builtin
              ? t("expert.form.systemPromptHintBuiltin")
              : t("expert.form.systemPromptHintCustom")
          }
        >
          <TextArea value={effectivePrompt} onChange={setSystemPrompt} rows={6} mono />
        </Field>
        <Field label={t("expert.form.appendPromptLabel")} hint={t("expert.form.appendPromptHint")}>
          <TextArea value={appendPrompt} onChange={setAppendPrompt} rows={2} />
        </Field>
        <Field
          label={t("expert.form.toolsLabel")}
          hint={!builtin ? t("expert.form.toolsHintCustom") : undefined}
        >
          {catalog ? (
            <ToolMultiSelect
              value={tools}
              onChange={setTools}
              catalog={catalog}
              mcpTools={mcpToolNames}
            />
          ) : (
            <EditableTags
              value={tools}
              onChange={setTools}
              placeholder={t("expert.form.toolExample")}
            />
          )}
        </Field>
        <Field label={t("expert.form.extensionsLabel")}>
          {catalog ? (
            <ExtensionMultiSelect
              value={extensions}
              onChange={setExtensions}
              options={catalog.extensions}
            />
          ) : (
            <EditableTags
              value={extensions}
              onChange={setExtensions}
              placeholder={t("expert.form.extExample")}
            />
          )}
        </Field>
        <Field label={t("expert.form.tagsLabel")} hint={t("expert.form.tagsHint")}>
          <EditableTags value={tags} onChange={setTags} placeholder={t("expert.form.tagExample")} />
        </Field>
      </div>
      <ModalFoot>
        {builtin ? (
          <>
            <button
              type="button"
              onClick={() => void copyAsCustom()}
              disabled={busy}
              className={btnGhost}
            >
              <IconPlus size={16} />
              {t("expert.form.copyAsCustom")}
            </button>
            <button
              type="button"
              onClick={() => void resetToDefault()}
              disabled={busy}
              className={btnGhost}
            >
              {t("expert.form.resetToDefault")}
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className={btnPrimary}
            >
              {t("common.save")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className={btnPrimary}
            >
              {t("common.save")}
            </button>
            <button type="button" onClick={() => void remove()} className={btnDanger}>
              {t("common.delete")}
            </button>
          </>
        )}
        <button type="button" onClick={onClose} className={btnGhost}>
          {t("common.close")}
        </button>
      </ModalFoot>
    </>
  );
}

/* ════════════ 专家团 ════════════ */

function TeamForm({ team, onClose }: { team: ExpertTeam; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useExpertCenterStore();
  const builtin = team.source === "builtin";
  const auto = team.routingStrategy === "auto";
  const workflowMode = team.routingStrategy === "workflow";
  const [expertIds, setExpertIds] = useState<string[]>(team.expertIds);
  const [leadExpertId, setLeadExpertId] = useState<string | null>(team.leadExpertId ?? null);
  const [roles, setRoles] = useState<Record<string, string>>(team.roles ?? {});
  const [busy, setBusy] = useState(false);
  // workflow 草稿：无自带 workflow 的 workflow 团队从空开始（画布设计）
  const [wf, setWf] = useState<TeamWorkflow | null>(
    () =>
      team.workflow ??
      (workflowMode
        ? {
            id: `wf-${crypto.randomUUID()}`,
            name: `${team.name} 流程`,
            steps: [],
            summarizerExpertId: team.expertIds.at(-1),
          }
        : null),
  );

  const save = async () => {
    setBusy(true);
    try {
      await store.updateTeam({
        id: team.id,
        expertIds,
        leadExpertId: auto ? leadExpertId : undefined,
        roles: Object.keys(roles).length > 0 ? roles : undefined,
        workflow: workflowMode && wf ? wf : undefined,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await store.deleteTeam(team.id);
    onClose();
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      await store.duplicateTeam(team.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const expertById = (id: string) => store.experts.find((e) => e.id === id);
  const leadExpert = leadExpertId ? expertById(leadExpertId) : undefined;
  // 画布可选的专家 = 团队成员（主 agent + 成员）
  const memberOptions = [...(leadExpertId ? [leadExpertId] : []), ...expertIds].map((id) => ({
    id,
    name: expertById(id)?.name ?? id,
  }));

  // 选主 agent：若该专家已在成员中则从成员移除（主 agent 与成员互斥）
  const onChangeLead = (v: string) => {
    setLeadExpertId(v || null);
    if (v) setExpertIds((prev) => prev.filter((id) => id !== v));
  };

  // 角色编辑行：主 agent 在前 + 成员（按选中顺序）
  const roleAgents: Array<{ id: string; name: string; icon?: string }> = [];
  if (leadExpertId && leadExpert) roleAgents.push(leadExpert);
  for (const id of expertIds) {
    const e = expertById(id);
    if (e) roleAgents.push(e);
  }

  const setRole = (id: string, role: string) =>
    setRoles((prev) => {
      const next = { ...prev };
      if (role.trim()) next[id] = role.trim();
      else delete next[id];
      return next;
    });

  return (
    <>
      <ModalHead
        icon={team.icon}
        tone="accent"
        title={team.name}
        sub={t("expert.team.memberSub", {
          description: team.description,
          num: teamMemberCount(team),
        })}
        onClose={onClose}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
        {/* 运行策略：只读标签（策略在新建时选定） */}
        <Field label={t("expert.team.strategyLabel")}>
          <TeamStrategyBadge strategy={team.routingStrategy} />
        </Field>

        {/* 主 agent（auto 团队） */}
        {auto ? (
          <div className="mt-[20px]">
            <Field label={t("expert.team.leadLabel")} hint={t("expert.team.leadHint")}>
              <Select
                value={leadExpertId ?? ""}
                onChange={onChangeLead}
                disabled={builtin}
                options={store.experts.map((e) => ({ value: e.id, label: e.name }))}
              />
            </Field>
          </div>
        ) : null}

        {/* 成员（候选不含主 agent） */}
        <div className="mt-[20px]">
          <Field label={t("expert.team.membersLabel")} hint={t("expert.team.membersHint")}>
            <div className="grid grid-cols-2 gap-[9px]">
              {store.experts
                .filter((e) => e.id !== leadExpertId)
                .map((e) => {
                  const on = expertIds.includes(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      disabled={builtin}
                      onClick={() =>
                        setExpertIds((prev) =>
                          on ? prev.filter((x) => x !== e.id) : [...prev, e.id],
                        )
                      }
                      className={`flex items-center gap-[10px] rounded-[10px] border p-[10px] px-[12px] text-left transition disabled:cursor-not-allowed ${
                        on
                          ? "border-accent-line bg-accent-tint"
                          : "border-line bg-card hover:bg-hover"
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
        </div>

        {/* 角色定义 */}
        {roleAgents.length > 0 ? (
          <div className="mt-[20px]">
            <Field label={t("expert.team.rolesLabel")} hint={t("expert.team.rolesHint")}>
              <AgentRoleRows
                agents={roleAgents}
                roles={roles}
                onChange={setRole}
                readOnly={builtin}
              />
            </Field>
          </div>
        ) : null}

        {/* workflow：自定义团队 → 画布设计器；内置示例 → 只读链式展示 */}
        {workflowMode && !builtin && wf ? (
          <div className="mt-[20px]">
            <Field label={t("expert.workflow.title")}>
              <WorkflowCanvas workflow={wf} onChange={setWf} members={memberOptions} />
            </Field>
          </div>
        ) : team.workflow ? (
          <div className="mt-[20px]">
            <Field
              label={`${t("expert.team.workflowReadonlyTitle")} · ${team.workflow.name}`}
              hint={t("expert.team.workflowReadonlyHint")}
            >
              <WorkflowStepsView workflow={team.workflow} expertById={expertById} />
            </Field>
          </div>
        ) : null}
      </div>
      <ModalFoot>
        {builtin ? (
          <button
            type="button"
            onClick={() => void duplicate()}
            disabled={busy}
            className={btnPrimary}
          >
            {t("expert.team.duplicate")}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className={btnPrimary}
            >
              {t("expert.team.saveMembers")}
            </button>
            <button type="button" onClick={() => void remove()} className={btnDanger}>
              {t("common.delete")}
            </button>
          </>
        )}
        <button type="button" onClick={onClose} className={btnGhost}>
          {t("common.close")}
        </button>
      </ModalFoot>
    </>
  );
}

/** workflow 步骤只读链式展示（含并行组） */
function WorkflowStepsView({
  workflow,
  expertById,
}: {
  workflow: TeamWorkflow;
  expertById: (id: string) => Expert | undefined;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {workflow.steps.map((step, i) => (
        <div key={step.id} className="flex items-center gap-[6px]">
          {i > 0 ? <span className="text-[14px] text-ink-3">→</span> : null}
          <StepChip step={step} expertById={expertById} />
        </div>
      ))}
    </div>
  );
}

function StepChip({
  step,
  expertById,
}: {
  step: WorkflowStep;
  expertById: (id: string) => Expert | undefined;
}) {
  if (step.kind === "serial") {
    const e = expertById(step.expertId);
    return (
      <div className="flex flex-col items-center gap-[3px] rounded-[9px] border border-line bg-paper px-[10px] py-[7px]">
        <span className="text-[11px] font-semibold text-ink">{step.id}</span>
        <span className="text-[10.5px] text-ink-3">{e?.name ?? step.expertId}</span>
      </div>
    );
  }
  if (step.kind === "conditional") {
    return (
      <div className="flex flex-col items-center gap-[3px] rounded-[9px] border border-purple-line bg-purple-tint px-[10px] py-[7px]">
        <span className="text-[11px] font-semibold text-ink">{step.id}</span>
        <span className="text-[10.5px] text-purple">条件</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-[4px] rounded-[9px] border border-accent-line bg-accent-tint px-[10px] py-[7px]">
      <span className="text-[11px] font-semibold text-ink">{step.id}</span>
      <div className="flex gap-[4px]">
        {step.steps.map((s) => {
          const e = expertById(s.expertId);
          return (
            <span
              key={s.id}
              className="rounded-[5px] bg-white px-[5px] py-[1px] text-[10.5px] text-ink-2"
            >
              {e?.name ?? s.expertId}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════ 技能 ════════════ */

function SkillForm({ skill, onClose }: { skill: SkillEntry; onClose: () => void }) {
  const { t } = useTranslation();
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
        <Field label={t("expert.skill.enabledLabel")}>
          <div className="flex items-center gap-[10px]">
            <Switch on={enabled} onChange={(v) => void toggleEnabled(v)} />
            <span className="text-[15px] text-ink-2">
              {enabled ? t("expert.skill.enabledOn") : t("expert.skill.enabledOff")}
            </span>
          </div>
        </Field>
        <Field label={t("expert.form.descriptionLabel")}>
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        <Field label={t("expert.create.skillContentLabel")} hint={t("expert.skill.contentHint")}>
          <TextArea value={content} onChange={setContent} rows={9} mono />
        </Field>
        <Field label={t("expert.form.tagsLabel")}>
          <EditableTags value={tags} onChange={setTags} placeholder="domain:product" />
        </Field>
      </div>
      <ModalFoot>
        <button type="button" onClick={() => void save()} disabled={busy} className={btnPrimary}>
          {t("common.save")}
        </button>
        {skill.source === "builtin" ? (
          <button type="button" disabled className={`${btnGhost} cursor-not-allowed opacity-40`}>
            {t("expert.skill.builtinNoUninstall")}
          </button>
        ) : (
          <button type="button" onClick={() => void uninstall()} className={btnDanger}>
            {t("expert.skill.uninstall")}
          </button>
        )}
        <button type="button" onClick={onClose} className={btnGhost}>
          {t("common.close")}
        </button>
      </ModalFoot>
    </>
  );
}

/* ════════════ 连接器 ════════════ */

const CONN_TYPE_LABEL: Record<string, string> = {
  mcp: "expert.connectorType.mcp",
  filesystem: "expert.connectorType.filesystem",
  "http-api": "expert.connectorType.httpApi",
  datasource: "expert.connectorType.datasource",
  custom: "expert.connectorType.custom",
};

function ConnectorForm({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useExpertCenterStore();
  const [name, setName] = useState(connector.name);
  const [description, setDescription] = useState(connector.description);
  const [config, setConfig] = useState<Record<string, unknown>>(connector.config ?? {});
  const [bound, setBound] = useState<string[]>(connector.boundExpertIds);
  const [enabled, setEnabled] = useState(connector.enabled);
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
      // 传输按 JSON 自动判断（有 url → Streamable HTTP，否则 stdio），保存时清理无关字段
      const clean = { ...config };
      const isHttp = typeof clean.url === "string" && clean.url.trim().length > 0;
      if (connector.type === "mcp" && isHttp) {
        delete clean.command;
        delete clean.args;
        delete clean.package;
        delete clean.version;
        delete clean.env;
        delete clean.transport;
      } else if (connector.type === "mcp") {
        delete clean.url;
        delete clean.headers;
        delete clean.transport;
      }
      await store.updateConnector({
        id: connector.id,
        name,
        description,
        config: clean,
        boundExpertIds: bound,
        enabled,
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

  const typeLabel = t(CONN_TYPE_LABEL[connector.type] ?? connector.type);

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
          <Note
            tone="warn"
            icon={<IconWarn size={18} />}
            title={t("expert.connector.reservedTitle")}
          >
            {t("expert.connector.reservedBody")}
          </Note>
        ) : status === "connected" ? (
          <Note
            tone="info"
            icon={<IconInfo size={18} />}
            title={t("expert.connector.connectedTitle")}
          >
            {t("expert.connector.connectedBody")}
          </Note>
        ) : null}
        {testMsg ? (
          <div className="mt-[12px] rounded-[10px] border border-line bg-paper px-[14px] py-[10px] text-[13px] text-ink-2">
            {t("expert.connector.testResult", { msg: translateError(testMsg, t) })}
          </div>
        ) : null}
        {connector.lastTools && connector.lastTools.length > 0 ? (
          <div className="mt-[12px]">
            <div className="mb-[6px] text-[12px] font-semibold tracking-[0.04em] text-ink-2">
              {t("expert.connector.probedTools", { num: connector.lastTools.length })}
            </div>
            <div className="flex max-h-[96px] flex-wrap gap-[5px] overflow-y-auto">
              {connector.lastTools.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </div>
        ) : null}

        <Field label={t("expert.form.nameLabel")}>
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label={t("expert.form.descriptionLabel")}>
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>

        <Field label={t("expert.connector.configLabel")}>
          {connector.type === "mcp" ? (
            <McpConfigForm config={config} replaceConfig={(c) => setConfig(c)} />
          ) : connector.type === "filesystem" ? (
            <div className="grid grid-cols-[140px_1fr] items-center gap-[14px]">
              <span className="text-[14px] text-ink-2">{t("expert.connector.whitelistRoot")}</span>
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
                <span className="text-[14px] text-ink-2">{t("expert.connector.auth")}</span>
                <TextInput
                  value={String(config.auth ?? "")}
                  onChange={(v) => setCfg("auth", v)}
                  placeholder="Bearer ***"
                />
              </div>
            </>
          ) : (
            <p className="text-[13px] text-ink-3">
              {t("expert.connector.customNote", { type: connector.type })}
            </p>
          )}
        </Field>

        <Field label={t("expert.connector.boundLabel")} hint={t("expert.connector.boundHint")}>
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

        <Field label={t("expert.connector.enabledLabel")}>
          <div className="flex items-center gap-[10px]">
            <Switch on={enabled} onChange={setEnabled} />
            <span className="text-[15px] text-ink-2">
              {enabled ? t("expert.connector.enabledOn") : t("expert.skill.enabledOff")}
            </span>
          </div>
        </Field>
      </div>
      <ModalFoot>
        <button type="button" onClick={() => void test()} className={btnGhost}>
          {t("expert.connector.testConnection")}
        </button>
        <button type="button" onClick={() => void save()} disabled={busy} className={btnPrimary}>
          {t("common.save")}
        </button>
        <button type="button" onClick={() => void remove()} className={btnDanger}>
          {t("common.delete")}
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          {t("common.close")}
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
  const { t } = useTranslation();
  const [json, setJson] = useState(() => serializeMcpJson(config));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // config 变化时同步编辑器内容（输入过程中 config 不变，不打断打字）
  useEffect(() => {
    setJson(serializeMcpJson(config));
    setJsonError(null);
  }, [config]);

  /** 传输按 JSON 自动判断：有 url → Streamable HTTP，否则 STDIO（实时从编辑器内容判断） */
  const isHttp = /"url"\s*:/.test(json);

  /** blur 提交：解析 JSON，按是否含 url 推断传输 */
  const commit = () => {
    const raw = json.trim();
    if (!raw) {
      replaceConfig({ ...config, transport: "stdio" });
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const p = parsed as Record<string, unknown>;
        const transport =
          typeof p.url === "string" && p.url.trim().length > 0 ? "streamable-http" : "stdio";
        replaceConfig({ ...p, transport });
        setJsonError(null);
      } else {
        setJsonError(t("errors.jsonObjectRequired"));
      }
    } catch {
      setJsonError(t("errors.jsonInvalid"));
    }
  };

  const applyTemplate = () => {
    const tmpl = isHttp
      ? { url: "", headers: { Authorization: "Bearer xxx" } }
      : { package: "@modelcontextprotocol/server-xxx", version: "", env: {} };
    setJson(JSON.stringify(tmpl, null, 2));
    setJsonError(null);
  };

  return (
    <>
      <div className="mb-[6px] flex items-center justify-between">
        <span className="text-[12.5px] font-semibold text-ink-2">
          {t("expert.connector.mcpJsonLabel")}
        </span>
        <button
          type="button"
          onClick={applyTemplate}
          className="text-[12px] font-semibold text-accent transition hover:underline"
        >
          {t("expert.connector.fillTemplate")}
        </button>
      </div>
      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        onBlur={commit}
        rows={8}
        spellCheck={false}
        placeholder={
          isHttp
            ? '{ "url": "https://api.example.com/mcp", "headers": { "Authorization": "Bearer xxx" } }'
            : '{ "package": "@modelcontextprotocol/server-xxx", "version": "", "env": { "KEY": "VALUE" } }'
        }
        className="w-full rounded-[10px] border border-line bg-card px-[14px] py-[10px] font-mono text-[12.5px] leading-[1.6] text-ink shadow-card transition focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent-tint"
      />
      {jsonError ? <p className="mt-[6px] text-[12.5px] text-danger">{jsonError}</p> : null}
      <p className="mt-[6px] text-[12.5px] leading-[1.6] text-ink-3">
        {t("expert.connector.jsonHintPrefix")}
        {isHttp
          ? t("expert.connector.jsonTransportHttp")
          : t("expert.connector.jsonTransportStdio")}
        {t("expert.connector.jsonHintSuffix")}
      </p>
    </>
  );
}

/* ════════════ 可编辑 chips（增删字符串列表） ════════════ */

export function EditableTags({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
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
        placeholder={placeholder ?? t("expert.tags.addPlaceholder")}
        className="rounded-full border border-dashed border-line-strong px-[12px] py-[4px] text-[13px] text-ink-3 outline-none transition placeholder:text-ink-3 focus:border-accent-line focus:text-ink-2"
      />
    </div>
  );
}
