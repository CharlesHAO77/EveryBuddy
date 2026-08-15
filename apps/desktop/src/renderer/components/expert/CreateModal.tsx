/**
 * CreateModal - 各 tab 的新建弹层（专家/专家团/技能/连接器）。
 */

import type { AgentMode, ConnectorType, TeamRoutingStrategy } from "@everybuddy/ipc-contract";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import { ModalShell } from "./DetailModal";
import { IconCheck, IconClose, IconPlus } from "./icons";
import {
  AgentRoleRows,
  btnGhost,
  btnPrimary,
  expertIcon,
  Field,
  Select,
  TextArea,
  TextInput,
} from "./ui";

type TabId = "expert" | "team" | "skill" | "connector";

const TYPE_OPTIONS: Array<{ id: ConnectorType; labelKey: string }> = [
  { id: "mcp", labelKey: "expert.connectorType.mcp" },
  { id: "filesystem", labelKey: "expert.connectorType.filesystem" },
  { id: "http-api", labelKey: "expert.connectorType.httpApi" },
  { id: "datasource", labelKey: "expert.connectorType.datasource" },
  { id: "custom", labelKey: "expert.connectorType.custom" },
];

const TITLES: Record<TabId, string> = {
  expert: "expert.new.expert",
  team: "expert.new.team",
  skill: "expert.new.skill",
  connector: "expert.new.connector",
};

/** 团队运行策略选项（新建时选定；详情只读展示标签） */
const TEAM_STRATEGY_OPTIONS: Array<{
  id: TeamRoutingStrategy;
  labelKey: string;
  descKey: string;
}> = [
  {
    id: "manual",
    labelKey: "expert.team.strategy.manual",
    descKey: "expert.team.strategy.manualDesc",
  },
  { id: "auto", labelKey: "expert.team.strategy.auto", descKey: "expert.team.strategy.autoDesc" },
  {
    id: "workflow",
    labelKey: "expert.team.strategy.workflow",
    descKey: "expert.team.strategy.workflowDesc",
  },
];

export function CreateModal({ kind, onClose }: { kind: TabId; onClose: () => void }) {
  const { t } = useTranslation();
  const store = useExpertCenterStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<AgentMode>("daily");
  const [type, setType] = useState<ConnectorType>("mcp");
  const [content, setContent] = useState("");
  // MCP 传输（新建连接器时即可选 STDIO / Streamable HTTP）
  const [transport, setTransport] = useState<"stdio" | "streamable-http">("stdio");
  const [mcpPackage, setMcpPackage] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  // 团队：策略 + 主 agent + 成员 + 角色
  const [strategy, setStrategy] = useState<TeamRoutingStrategy>("manual");
  const [expertIds, setExpertIds] = useState<string[]>([]);
  const [leadExpertId, setLeadExpertId] = useState<string | null>(null);
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const isTeam = kind === "team";
  const expertById = (id: string) => store.experts.find((e) => e.id === id);
  const leadExpert = leadExpertId ? expertById(leadExpertId) : undefined;

  // 角色编辑行：主 agent 在前 + 成员
  const roleAgents: Array<{ id: string; name: string; icon?: string }> = [];
  if (leadExpertId && leadExpert) roleAgents.push(leadExpert);
  for (const id of expertIds) {
    const e = expertById(id);
    if (e) roleAgents.push(e);
  }

  // 选主 agent：与成员互斥（若已在成员中则移除）
  const onChangeLead = (v: string) => {
    setLeadExpertId(v || null);
    if (v) setExpertIds((prev) => prev.filter((id) => id !== v));
  };

  const setRole = (id: string, role: string) =>
    setRoles((prev) => {
      const next = { ...prev };
      if (role.trim()) next[id] = role.trim();
      else delete next[id];
      return next;
    });

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (kind === "expert") await store.createExpert({ name, description, mode });
      else if (kind === "team")
        await store.createTeam({
          name,
          description,
          routingStrategy: strategy,
          expertIds,
          leadExpertId: strategy === "auto" ? (leadExpertId ?? undefined) : undefined,
          roles: Object.keys(roles).length > 0 ? roles : undefined,
        });
      else if (kind === "skill") await store.createSkill({ name, description, content });
      else if (kind === "connector") {
        const config =
          type === "mcp"
            ? transport === "streamable-http"
              ? { transport, url: mcpUrl }
              : { transport, package: mcpPackage.trim() || undefined }
            : undefined;
        await store.createConnector({ name, description, type, config });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="flex shrink-0 items-center gap-[14px] border-b border-line px-[24px] py-[20px]">
        <div className="min-w-0 flex-1">
          <div className="text-[20px] font-bold text-ink">{t(TITLES[kind])}</div>
          <div className="mt-[3px] text-[14px] text-ink-2">
            {kind === "skill" ? t("expert.create.skillSubtitle") : t("expert.create.basicSubtitle")}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[8px] text-ink-3 transition hover:bg-hover hover:text-ink"
        >
          <IconClose size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-[24px] py-[22px]">
        <Field
          label={
            kind === "skill" ? t("expert.create.skillNameLabel") : t("expert.create.nameLabel")
          }
        >
          <TextInput
            value={name}
            onChange={setName}
            placeholder={kind === "skill" ? "prd-writer" : undefined}
          />
        </Field>
        <Field label={t("expert.create.descriptionLabel")}>
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        {isTeam ? (
          <>
            {/* 运行策略（新建时选定；详情只读展示标签） */}
            <Field label={t("expert.team.strategyLabel")} hint={t("expert.team.strategyHint")}>
              <div className="grid grid-cols-3 gap-[9px]">
                {TEAM_STRATEGY_OPTIONS.map((opt) => {
                  const on = strategy === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setStrategy(opt.id)}
                      className={`flex flex-col gap-[4px] rounded-[10px] border p-[10px] text-left transition ${
                        on
                          ? "border-accent-line bg-accent-tint"
                          : "border-line bg-card hover:bg-hover"
                      }`}
                    >
                      <span
                        className={`text-[13px] font-semibold ${on ? "text-accent-strong" : "text-ink"}`}
                      >
                        {t(opt.labelKey)}
                      </span>
                      <span className="text-[11.5px] leading-[1.45] text-ink-3">
                        {t(opt.descKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Field>

            {/* 主 agent（团队调度） */}
            {strategy === "auto" ? (
              <div className="mt-[16px]">
                <Field label={t("expert.team.leadLabel")} hint={t("expert.team.leadHint")}>
                  <Select
                    value={leadExpertId ?? ""}
                    onChange={onChangeLead}
                    options={store.experts.map((e) => ({ value: e.id, label: e.name }))}
                  />
                </Field>
              </div>
            ) : null}

            {/* 成员（候选不含主 agent） */}
            <div className="mt-[16px]">
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
                          onClick={() =>
                            setExpertIds((prev) =>
                              on ? prev.filter((x) => x !== e.id) : [...prev, e.id],
                            )
                          }
                          className={`flex items-center gap-[10px] rounded-[10px] border p-[10px] px-[12px] text-left transition ${
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
              <div className="mt-[16px]">
                <Field label={t("expert.team.rolesLabel")} hint={t("expert.team.rolesHint")}>
                  <AgentRoleRows agents={roleAgents} roles={roles} onChange={setRole} />
                </Field>
              </div>
            ) : null}
          </>
        ) : null}
        {kind === "expert" ? (
          <Field label={t("expert.create.modeLabel")}>
            <Select
              value={mode}
              onChange={(v) => setMode(v as AgentMode)}
              options={[
                { value: "daily", label: t("expert.create.modeDaily") },
                { value: "coding", label: t("expert.create.modeCoding") },
              ]}
            />
          </Field>
        ) : null}
        {kind === "connector" ? (
          <>
            <Field label={t("expert.create.typeLabel")}>
              <Select
                value={type}
                onChange={(v) => setType(v as ConnectorType)}
                options={TYPE_OPTIONS.map((o) => ({ value: o.id, label: t(o.labelKey) }))}
              />
            </Field>
            {type === "mcp" ? (
              <>
                <Field label={t("expert.create.transportLabel")}>
                  <div className="grid grid-cols-2 gap-[8px]">
                    {(
                      [
                        ["stdio", "expert.create.transportStdio"],
                        ["streamable-http", "expert.create.transportHttp"],
                      ] as const
                    ).map(([id, labelKey]) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setTransport(id)}
                        className={`rounded-[8px] border px-[12px] py-[9px] text-[13.5px] font-semibold transition ${
                          transport === id
                            ? "border-accent bg-accent-tint text-accent-strong"
                            : "border-line bg-card text-ink-2 hover:bg-hover"
                        }`}
                      >
                        {t(labelKey)}
                      </button>
                    ))}
                  </div>
                </Field>
                {transport === "streamable-http" ? (
                  <Field label="Server URL">
                    <TextInput
                      value={mcpUrl}
                      onChange={setMcpUrl}
                      placeholder="https://api.example.com/mcp"
                    />
                  </Field>
                ) : (
                  <Field
                    label={t("expert.create.mcpPackageLabel")}
                    hint={t("expert.create.mcpPackageHint")}
                  >
                    <TextInput
                      value={mcpPackage}
                      onChange={setMcpPackage}
                      placeholder="@modelcontextprotocol/server-xxx"
                    />
                  </Field>
                )}
              </>
            ) : null}
          </>
        ) : null}
        {kind === "skill" ? (
          <Field
            label={t("expert.create.skillContentLabel")}
            hint={t("expert.create.skillContentHint")}
          >
            <TextArea value={content} onChange={setContent} rows={9} mono />
          </Field>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap justify-end gap-[10px] border-t border-line bg-paper px-[24px] py-[14px]">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || !name.trim()}
          className={`${btnPrimary} ${!name.trim() ? "cursor-not-allowed opacity-50" : ""}`}
        >
          <IconPlus size={16} />
          {t("common.create")}
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          {t("common.cancel")}
        </button>
      </div>
    </ModalShell>
  );
}
