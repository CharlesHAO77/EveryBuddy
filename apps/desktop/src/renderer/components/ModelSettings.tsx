/**
 * ModelSettings - 模型配置面板（见 §6.7）。
 * 模型配置经 IPC 持久化到主进程；apiKey 只写不读（显示「已配置」）。
 */

import type { ModelProviderConfig, SaveModelRequest } from "@everybuddy/ipc-contract";
import { useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { IconTrash, IconX } from "./icons";

interface ModelSettingsProps {
  onClose: () => void;
}

interface Draft extends SaveModelRequest {}

export function ModelSettings({ onClose }: ModelSettingsProps) {
  const models = useUIStore((s) => s.models);
  const currentModelId = useUIStore((s) => s.currentModelId);
  const setCurrentModel = useUIStore((s) => s.setCurrentModel);
  const saveModel = useUIStore((s) => s.saveModel);
  const removeModel = useUIStore((s) => s.removeModel);
  const setApiKey = useUIStore((s) => s.setApiKey);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<Record<string, string>>({});

  const startAdd = () => {
    const id = crypto.randomUUID();
    setDraft({
      id,
      name: "",
      baseUrl: "https://api.openai.com/v1",
      model: "",
      isOpenAiCompatible: true,
      capabilities: { vision: false, imageGen: false },
    });
    setEditingId(id);
  };

  const startEdit = (m: ModelProviderConfig) => {
    setDraft({
      id: m.id,
      name: m.name,
      baseUrl: m.baseUrl,
      model: m.model,
      isOpenAiCompatible: m.isOpenAiCompatible,
      capabilities: m.capabilities ?? { vision: false, imageGen: false },
    });
    setEditingId(m.id);
  };

  const saveDraft = async () => {
    if (!draft?.name || !draft.baseUrl || !draft.model) return;
    await saveModel(draft);
    setEditingId(null);
    setDraft(null);
  };

  const handleSetApiKey = async (providerId: string) => {
    const key = apiKeyInput[providerId]?.trim();
    if (!key) return;
    await setApiKey(providerId, key);
    setApiKeyInput((prev) => ({ ...prev, [providerId]: "" }));
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-l bg-paper shadow-modal">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-ink">模型设置</h2>
            <p className="text-[12px] text-ink-3">支持 OpenAI 兼容格式的自定义模型</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-s p-1 text-ink-3 transition hover:bg-accent-tint hover:text-ink-2"
          >
            <IconX title="关闭" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-3">
            {models.map((m) => (
              <div
                key={m.id}
                className={`rounded-m border p-4 transition ${
                  currentModelId === m.id
                    ? "border-line-strong bg-active"
                    : "border-line bg-card hover:bg-hover hover:border-line-strong"
                }`}
              >
                {editingId === m.id && draft ? (
                  <ModelForm
                    draft={draft}
                    onChange={setDraft}
                    onSave={saveDraft}
                    onCancel={() => {
                      setEditingId(null);
                      setDraft(null);
                    }}
                  />
                ) : (
                  <div>
                    <div className="flex items-start justify-between">
                      <button
                        type="button"
                        onClick={() => setCurrentModel(m.id)}
                        className="flex-1 text-left"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink">{m.name}</span>
                          {currentModelId === m.id && (
                            <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">
                              当前
                            </span>
                          )}
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
                      </button>
                      <div className="flex items-center gap-1">
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
                    {/* API Key 设置 */}
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
                        onChange={(e) => setApiKeyInput((p) => ({ ...p, [m.id]: e.target.value }))}
                        placeholder={m.hasApiKey ? "输入新 Key 替换" : "输入 API Key"}
                        className="flex-1 rounded-s border border-line bg-card px-2 py-1 text-[13px] text-ink focus:border-accent focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleSetApiKey(m.id)}
                        disabled={!apiKeyInput[m.id]?.trim()}
                        className="rounded-full bg-accent px-2 py-1 text-[13px] font-semibold text-white transition hover:bg-accent-strong disabled:opacity-40"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {editingId && !models.some((m) => m.id === editingId) && draft && (
              <div className="rounded-m border border-line-strong bg-active p-4">
                <ModelForm
                  draft={draft}
                  onChange={setDraft}
                  onSave={saveDraft}
                  onCancel={() => {
                    setEditingId(null);
                    setDraft(null);
                  }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={startAdd}
            disabled={editingId !== null}
            className="w-full rounded-full border border-dashed border-accent-line py-2 text-[14px] font-semibold text-accent transition hover:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-50"
          >
            + 添加 OpenAI 兼容模型
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModelFormProps {
  draft: SaveModelRequest;
  onChange: (draft: SaveModelRequest) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ModelForm({ draft, onChange, onSave, onCancel }: ModelFormProps) {
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
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
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
          onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
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
          onChange={(e) => onChange({ ...draft, model: e.target.value })}
          placeholder="gpt-4o"
        />
      </div>
      <label className="flex items-center gap-2 text-[14px] text-ink">
        <input
          type="checkbox"
          checked={draft.isOpenAiCompatible}
          onChange={(e) => onChange({ ...draft, isOpenAiCompatible: e.target.checked })}
          className="h-4 w-4 rounded border-line-strong text-accent"
        />
        OpenAI 兼容格式
      </label>
      <div className="flex items-center gap-4 pt-1">
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input
            type="checkbox"
            checked={draft.capabilities.vision}
            onChange={(e) =>
              onChange({
                ...draft,
                capabilities: { ...draft.capabilities, vision: e.target.checked },
              })
            }
            className="h-4 w-4 rounded border-line-strong text-accent"
          />
          视觉理解
        </label>
        <label className="flex items-center gap-2 text-[14px] text-ink">
          <input
            type="checkbox"
            checked={draft.capabilities.imageGen}
            onChange={(e) =>
              onChange({
                ...draft,
                capabilities: { ...draft.capabilities, imageGen: e.target.checked },
              })
            }
            className="h-4 w-4 rounded border-line-strong text-accent"
          />
          生图
        </label>
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
