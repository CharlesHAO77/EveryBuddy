/**
 * CreateModal - 各 tab 的新建弹层（专家/专家团/技能/连接器）。
 */

import type { AgentMode, ConnectorType } from "@everybuddy/ipc-contract";
import { useState } from "react";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import { ModalShell } from "./DetailModal";
import { IconClose, IconPlus } from "./icons";
import { btnGhost, btnPrimary, Field, Select, TextArea, TextInput } from "./ui";

type TabId = "expert" | "team" | "skill" | "connector";

const TYPE_OPTIONS: Array<{ id: ConnectorType; label: string }> = [
  { id: "mcp", label: "MCP Server" },
  { id: "filesystem", label: "文件系统" },
  { id: "http-api", label: "HTTP API" },
  { id: "datasource", label: "数据源" },
  { id: "custom", label: "自定义" },
];

const TITLES: Record<TabId, string> = {
  expert: "新建专家",
  team: "新建专家团",
  skill: "新建技能",
  connector: "新建连接器",
};

export function CreateModal({ kind, onClose }: { kind: TabId; onClose: () => void }) {
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
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (kind === "expert") await store.createExpert({ name, description, mode });
      else if (kind === "team") await store.createTeam({ name, description });
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
          <div className="text-[20px] font-bold text-ink">{TITLES[kind]}</div>
          <div className="mt-[3px] text-[14px] text-ink-2">
            {kind === "skill"
              ? "技能 = 一个目录里的 SKILL.md（对齐 pi SDK Skill）"
              : "填写基本信息，保存后出现在对应 tab"}
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
        <Field label={kind === "skill" ? "技能名（kebab-case，即目录名）" : "名称"}>
          <TextInput
            value={name}
            onChange={setName}
            placeholder={kind === "skill" ? "prd-writer" : undefined}
          />
        </Field>
        <Field label="描述">
          <TextArea value={description} onChange={setDescription} rows={2} />
        </Field>
        {kind === "expert" ? (
          <Field label="基准模式">
            <Select
              value={mode}
              onChange={(v) => setMode(v as AgentMode)}
              options={[
                { value: "daily", label: "daily 日常办公" },
                { value: "coding", label: "coding 代码开发" },
              ]}
            />
          </Field>
        ) : null}
        {kind === "connector" ? (
          <>
            <Field label="类型">
              <Select
                value={type}
                onChange={(v) => setType(v as ConnectorType)}
                options={TYPE_OPTIONS.map((t) => ({ value: t.id, label: t.label }))}
              />
            </Field>
            {type === "mcp" ? (
              <>
                <Field label="传输方式">
                  <div className="grid grid-cols-2 gap-[8px]">
                    {(
                      [
                        ["stdio", "STDIO · 本地进程"],
                        ["streamable-http", "Streamable HTTP · 远程"],
                      ] as const
                    ).map(([id, label]) => (
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
                        {label}
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
                    label="npm 包（托管安装到 ~/EveryBuddy/mcp-servers/）"
                    hint="首次测试连接时自动 npm install，绕开 npx 漏装依赖问题。"
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
          <Field label="SKILL.md 正文" hint="name/description 会写入 frontmatter，正文在下方。">
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
          创建
        </button>
        <button type="button" onClick={onClose} className={btnGhost}>
          取消
        </button>
      </div>
    </ModalShell>
  );
}
