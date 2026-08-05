/**
 * ModelSettings - 模型配置面板（见 §6.7）。
 * 模型配置经 IPC 持久化到主进程；apiKey 只写不读（显示「已配置」）。
 */

import type { ModelProviderConfig, SaveModelRequest } from "@everybuddy/ipc-contract";
import { useState } from "react";
import { useUIStore } from "../stores/uiStore";

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--text-main)]">模型设置</h2>
            <p className="text-[11px] text-[var(--text-muted)]">支持 OpenAI 兼容格式的自定义模型</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-[var(--text-muted)] transition hover:bg-[var(--primary-bg)]"
          >
            <CloseIcon />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-3">
            {models.map((m) => (
              <div
                key={m.id}
                className={`rounded-xl border p-4 transition ${
                  currentModelId === m.id
                    ? "border-[var(--primary)] bg-[var(--primary-bg)]"
                    : "border-[var(--border)] bg-[var(--surface-card)] hover:border-[var(--primary-light)]"
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
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--text-main)]">{m.name}</span>
                          {currentModelId === m.id && (
                            <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-medium text-white">
                              当前
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                          {m.model} · {m.baseUrl}
                        </div>
                      </button>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => startEdit(m)}
                          className="rounded-lg px-2 py-1 text-[11px] text-[var(--text-muted)] transition hover:bg-[var(--primary-bg)]"
                        >
                          编辑
                        </button>
                        {models.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeModel(m.id)}
                            className="rounded-lg p-1 text-red-500 transition hover:bg-red-50"
                          >
                            <TrashIcon />
                          </button>
                        )}
                      </div>
                    </div>
                    {/* API Key 设置 */}
                    <div className="mt-2 flex items-center gap-2">
                      {m.hasApiKey ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-[10px] text-green-600">
                          ✓ API Key 已配置
                        </span>
                      ) : (
                        <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[10px] text-orange-500">
                          未配置 API Key
                        </span>
                      )}
                      <input
                        type="password"
                        value={apiKeyInput[m.id] ?? ""}
                        onChange={(e) => setApiKeyInput((p) => ({ ...p, [m.id]: e.target.value }))}
                        placeholder={m.hasApiKey ? "输入新 Key 替换" : "输入 API Key"}
                        className="flex-1 rounded-md border border-[var(--border)] bg-white px-2 py-1 text-[11px] focus:border-[var(--primary-light)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleSetApiKey(m.id)}
                        disabled={!apiKeyInput[m.id]?.trim()}
                        className="rounded-md bg-[var(--primary)] px-2 py-1 text-[10px] font-medium text-white transition hover:bg-[var(--primary-dark)] disabled:opacity-40"
                      >
                        保存
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {editingId && !models.some((m) => m.id === editingId) && draft && (
              <div className="rounded-xl border border-[var(--primary-light)] bg-[var(--primary-bg)] p-4">
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
        <div className="border-t border-[var(--border)] px-5 py-3">
          <button
            type="button"
            onClick={startAdd}
            disabled={editingId !== null}
            className="w-full rounded-full border border-dashed border-[var(--primary-light)] py-2 text-[13px] font-medium text-[var(--primary)] transition hover:bg-[var(--primary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
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
    "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-[13px] outline-none transition focus:border-[var(--primary-light)]";
  const label = "mb-1 block text-[11px] font-medium text-[var(--text-muted)]";

  return (
    <div className="space-y-2.5">
      <div>
        <label className={label}>显示名称</label>
        <input
          className={field}
          value={draft.name}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="例如：SiliconFlow"
        />
      </div>
      <div>
        <label className={label}>Base URL</label>
        <input
          className={field}
          value={draft.baseUrl}
          onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
        />
      </div>
      <div>
        <label className={label}>Model</label>
        <input
          className={field}
          value={draft.model}
          onChange={(e) => onChange({ ...draft, model: e.target.value })}
          placeholder="gpt-4o"
        />
      </div>
      <label className="flex items-center gap-2 text-[13px] text-[var(--text-main)]">
        <input
          type="checkbox"
          checked={draft.isOpenAiCompatible}
          onChange={(e) => onChange({ ...draft, isOpenAiCompatible: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-[var(--primary)]"
        />
        OpenAI 兼容格式
      </label>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-1.5 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--primary-bg)]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-full bg-[var(--primary)] px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-[var(--primary-dark)] active:scale-95"
        >
          保存
        </button>
      </div>
    </div>
  );
}
