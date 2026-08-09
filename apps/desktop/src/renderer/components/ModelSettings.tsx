/**
 * ModelSettings - 模型配置分区（SettingsPanel 内，见 §6.7）。
 * 模型按 LLM / VLM / Image 分类管理；类型唯一决定能力（capabilities 由主进程派生）。
 * 添加与编辑时类型均按分类固定不可改（用户确认）；默认恒为 OpenAI 兼容格式（无勾选）。
 * 表单直接填 API Key；模型配置经 IPC 持久化到主进程，apiKey 只写不读（显示「已配置」）。
 */

import type { ModelProviderConfig, ModelType, SaveModelRequest } from "@everybuddy/ipc-contract";
import { useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { IconTrash } from "./icons";

const TYPE_LABELS: Record<ModelType, string> = { llm: "LLM", vlm: "VLM", image: "Image" };

const GROUPS: Array<{ type: ModelType; label: string }> = [
  { type: "llm", label: "LLM 模型" },
  { type: "vlm", label: "VLM 模型" },
  { type: "image", label: "Image 模型" },
];

/** 类型徽标配色：llm 中性，vlm/image accent-tint */
const typeBadge: Record<ModelType, string> = {
  llm: "bg-hover text-ink-2",
  vlm: "bg-accent-tint text-accent-strong",
  image: "bg-accent-tint text-accent-strong",
};

export function ModelSettings() {
  const models = useUIStore((s) => s.models);
  const saveModel = useUIStore((s) => s.saveModel);
  const removeModel = useUIStore((s) => s.removeModel);
  const setApiKey = useUIStore((s) => s.setApiKey);
  const setActiveModel = useUIStore((s) => s.setActiveModel);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaveModelRequest | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<Record<string, string>>({});

  const startAdd = (type: ModelType) => {
    const id = crypto.randomUUID();
    setDraft({
      id,
      name: "",
      baseUrl: "https://api.openai.com/v1",
      model: "",
      isOpenAiCompatible: true,
      type,
    });
    setEditingId(id);
  };

  const startEdit = (m: ModelProviderConfig) => {
    setDraft({
      id: m.id,
      name: m.name,
      baseUrl: m.baseUrl,
      model: m.model,
      // 默认恒为 OpenAI 兼容格式（用户确认，无可选项）
      isOpenAiCompatible: true,
      type: m.type,
    });
    setEditingId(m.id);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveDraft = async () => {
    if (!draft?.name || !draft.baseUrl || !draft.model) return;
    await saveModel(draft);
    // 表单内直接写入 API Key：留空则仅保存模型
    const key = apiKeyInput[draft.id]?.trim();
    if (key) {
      await setApiKey(draft.id, key);
      setApiKeyInput((prev) => ({ ...prev, [draft.id]: "" }));
    }
    cancelEdit();
  };

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h2 className="text-[16px] font-semibold text-ink">模型设置</h2>
      <p className="text-[12px] text-ink-3">支持 OpenAI 兼容格式的自定义模型，按类型分类管理</p>

      <div className="mt-6 flex flex-col gap-6">
        {GROUPS.map((g) => (
          <div key={g.type}>
            {/* 分组头 */}
            <div className="flex h-[30px] items-center gap-2">
              <span className="text-[12px] font-semibold tracking-[0.08em] text-ink-3">{g.label}</span>
              <span className="text-[12px] text-ink-3">
                ({models.filter((m) => m.type === g.type).length})
              </span>
            </div>

            {/* 该组模型卡片 */}
            <div className="mt-2 space-y-3">
              {models
                .filter((m) => m.type === g.type)
                .map((m) => {
                  const isEditing = editingId === m.id;
                  return (
                    <div
                      key={m.id}
                      className={`rounded-m border p-4 transition ${
                        isEditing || m.active
                          ? "border-line-strong bg-active"
                          : "border-line bg-card hover:bg-hover hover:border-line-strong"
                      }`}
                    >
                      {isEditing && draft ? (
                        <ModelForm
                          mode="edit"
                          draft={draft}
                          apiKey={apiKeyInput[m.id] ?? ""}
                          onDraftChange={setDraft}
                          onApiKeyChange={(v) => setApiKeyInput((prev) => ({ ...prev, [m.id]: v }))}
                          onSave={saveDraft}
                          onCancel={cancelEdit}
                        />
                      ) : (
                        <div>
                          <div className="flex items-start justify-between">
                            <div className="flex-1 text-left">
                              <ModelInfo m={m} isActive={m.active} />
                            </div>
                            <div className="flex items-center gap-1">
                              {!m.active && (
                                <button
                                  type="button"
                                  onClick={() => setActiveModel(m.id)}
                                  className="rounded-s px-2 py-1 text-[13px] font-semibold text-accent-strong transition hover:bg-accent-tint"
                                >
                                  设为激活
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => startEdit(m)}
                                className="rounded-s px-2 py-1 text-[13px] text-ink-3 transition hover:bg-accent-tint hover:text-ink-2"
                              >
                                编辑
                              </button>
                              {models.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeModel(m.id)}
                                  className="rounded-s p-1 text-danger transition hover:bg-danger/10"
                                >
                                  <IconTrash size={13} strokeWidth={2} title="删除模型" />
                                </button>
                              )}
                            </div>
                          </div>
                          {/* API Key 行 */}
                          <div className="mt-2 flex items-center gap-2">
                            {m.hasApiKey ? (
                              <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[11px] text-accent-strong">
                                ✓ API Key 已配置
                              </span>
                            ) : (
                              <span className="rounded-full bg-hover px-2 py-0.5 text-[11px] text-ink-3">
                                未配置 API Key
                              </span>
                            )}
                            <input
                              type="password"
                              value={apiKeyInput[m.id] ?? ""}
                              onChange={(e) =>
                                setApiKeyInput((prev) => ({ ...prev, [m.id]: e.target.value }))
                              }
                              placeholder={m.hasApiKey ? "输入新 Key 替换" : "输入 API Key"}
                              className="flex-1 rounded-s border border-line bg-card px-2 py-1 text-[13px] text-ink focus:border-accent focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                const key = apiKeyInput[m.id]?.trim();
                                if (!key) return;
                                await setApiKey(m.id, key);
                                setApiKeyInput((prev) => ({ ...prev, [m.id]: "" }));
                              }}
                              disabled={!apiKeyInput[m.id]?.trim()}
                              className="rounded-full bg-accent px-2 py-1 text-[13px] font-semibold text-white transition hover:bg-accent-strong disabled:opacity-40"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>

            {/* 组内添加按钮 + 新模型表单（类型已固定为该组） */}
            <button
              type="button"
              onClick={() => startAdd(g.type)}
              disabled={editingId !== null}
              className="mt-2 w-full rounded-full border border-dashed border-accent-line py-2 text-[13px] font-semibold text-accent transition hover:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-50"
            >
              + 添加 {g.label}
            </button>
            {editingId &&
              draft &&
              draft.type === g.type &&
              !models.some((m) => m.id === editingId) && (
                <div className="rounded-m border border-line-strong bg-active p-4">
                  <ModelForm
                    mode="add"
                    draft={draft}
                    apiKey={apiKeyInput[draft.id] ?? ""}
                    onDraftChange={setDraft}
                    onApiKeyChange={(v) =>
                      setApiKeyInput((prev) => ({ ...prev, [draft.id]: v }))
                    }
                    onSave={saveDraft}
                    onCancel={cancelEdit}
                  />
                </div>
              )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** 卡片信息：名称 + 「激活」/类型/能力徽标 + model·baseUrl（image 卡片带「生图专用」提示） */
function ModelInfo({ m, isActive }: { m: ModelProviderConfig; isActive: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-ink">{m.name}</span>
        {isActive && (
          <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
            激活
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 text-[11px] ${typeBadge[m.type]}`}>
          {TYPE_LABELS[m.type]}
        </span>
        {m.capabilities?.vision && (
          <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[11px] text-accent-strong">
            视觉
          </span>
        )}
        {m.capabilities?.imageGen && (
          <span className="rounded-full bg-accent-tint px-2 py-0.5 text-[11px] text-accent-strong">
            生图
          </span>
        )}
      </div>
      <div className="mt-1 text-[12px] text-ink-3">
        {m.model} · {m.baseUrl}
      </div>
      {m.type === "image" && (
        <div className="mt-1 text-[11px] text-ink-3">生图专用，不可作为对话模型</div>
      )}
    </div>
  );
}

interface ModelFormProps {
  /** 仅用于区分 API Key 占位文案；类型添加/编辑均按分类固定 */
  mode: "add" | "edit";
  draft: SaveModelRequest;
  apiKey: string;
  onDraftChange: (draft: SaveModelRequest) => void;
  onApiKeyChange: (key: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ModelForm({
  mode,
  draft,
  apiKey,
  onDraftChange,
  onApiKeyChange,
  onSave,
  onCancel,
}: ModelFormProps) {
  const field =
    "w-full rounded-s border border-line bg-card px-3 py-2 text-[14px] text-ink outline-none transition focus:border-accent";
  const label = "mb-1 block text-[12px] font-semibold text-ink-3";

  return (
    <div className="space-y-2.5">
      <div>
        <label htmlFor="model-name" className={label}>
          显示名称
        </label>
        <input
          id="model-name"
          className={field}
          value={draft.name}
          onChange={(e) => onDraftChange({ ...draft, name: e.target.value })}
          placeholder="例如：SiliconFlow"
        />
      </div>
      <div>
        <label htmlFor="model-base-url" className={label}>
          Base URL
        </label>
        <input
          id="model-base-url"
          className={field}
          value={draft.baseUrl}
          onChange={(e) => onDraftChange({ ...draft, baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </div>
      <div>
        <label htmlFor="model-id" className={label}>
          Model
        </label>
        <input
          id="model-id"
          className={field}
          value={draft.model}
          onChange={(e) => onDraftChange({ ...draft, model: e.target.value })}
          placeholder="gpt-4o"
        />
      </div>
      <div>
        <label htmlFor="model-apikey" className={label}>
          API Key
        </label>
        <input
          id="model-apikey"
          type="password"
          className={field}
          value={apiKey}
          onChange={(e) => onApiKeyChange(e.target.value)}
          placeholder={mode === "edit" ? "留空则不修改 API Key" : "sk-...（可留空）"}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-s px-3 py-1.5 text-[13px] text-ink-3 transition hover:bg-accent-tint"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-white transition hover:bg-accent-strong active:scale-95"
        >
          保存
        </button>
      </div>
    </div>
  );
}
