import { useState } from "react";
import { useUIStore, type ModelConfig } from "../stores/uiStore";

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
  </svg>
);

interface ModelSettingsProps {
  onClose: () => void;
}

export function ModelSettings({ onClose }: ModelSettingsProps) {
  const { models, currentModelId, addModel, removeModel, setCurrentModel, updateModel } = useUIStore();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<ModelConfig>>({
    name: "",
    baseUrl: "",
    apiKey: "",
    model: "",
    isOpenAiCompatible: true,
  });

  const startAdd = () => {
    const id = crypto.randomUUID();
    setDraft({
      id,
      name: "",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4o",
      isOpenAiCompatible: true,
    });
    setEditingId(id);
  };

  const startEdit = (model: ModelConfig) => {
    setDraft({ ...model });
    setEditingId(model.id);
  };

  const saveDraft = () => {
    if (!draft.name || !draft.baseUrl || !draft.model) return;

    const exists = models.some((m) => m.id === editingId);
    const model: ModelConfig = {
      id: editingId ?? crypto.randomUUID(),
      name: draft.name,
      baseUrl: draft.baseUrl,
      apiKey: draft.apiKey ?? "",
      model: draft.model,
      isOpenAiCompatible: draft.isOpenAiCompatible ?? true,
    };

    if (exists) {
      updateModel(model.id, model);
    } else {
      addModel(model);
    }

    setCurrentModel(model.id);
    setEditingId(null);
    setDraft({ name: "", baseUrl: "", apiKey: "", model: "", isOpenAiCompatible: true });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text-main)]">模型设置</h2>
            <p className="text-xs text-[var(--text-muted)]">支持 OpenAI 兼容格式的自定义模型</p>
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
            {models.map((model) => (
              <div
                key={model.id}
                className={`rounded-xl border p-4 transition ${
                  currentModelId === model.id
                    ? "border-[var(--primary)] bg-[var(--primary-bg)] shadow-[var(--shadow-card)]"
                    : "border-[var(--border)] bg-[var(--surface-card)] hover:border-[var(--primary-light)]"
                }`}
              >
                {editingId === model.id ? (
                  <ModelForm
                    draft={draft}
                    onChange={setDraft}
                    onSave={saveDraft}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <div className="flex items-start justify-between">
                    <button
                      type="button"
                      onClick={() => setCurrentModel(model.id)}
                      className="flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--text-main)]">{model.name}</span>
                        {currentModelId === model.id && (
                          <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[10px] font-medium text-white">
                            当前
                          </span>
                        )}
                        {model.isOpenAiCompatible && (
                          <span className="rounded-full bg-[var(--primary-bg)] px-2 py-0.5 text-[10px] text-[var(--primary-dark)]">
                            OpenAI 兼容
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">
                        {model.model} · {model.baseUrl}
                      </div>
                    </button>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(model)}
                        className="rounded-lg px-2 py-1 text-xs text-[var(--text-muted)] transition hover:bg-[var(--primary-bg)]"
                      >
                        编辑
                      </button>
                      {models.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeModel(model.id)}
                          className="rounded-lg p-1 text-red-500 transition hover:bg-red-50"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {editingId && !models.some((m) => m.id === editingId) && (
              <div className="rounded-xl border border-[var(--primary-light)] bg-[var(--primary-bg)] p-4">
                <ModelForm
                  draft={draft}
                  onChange={setDraft}
                  onSave={saveDraft}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-[var(--border)] px-5 py-4">
          <button
            type="button"
            onClick={startAdd}
            disabled={editingId !== null}
            className="w-full rounded-full border border-dashed border-[var(--primary-light)] py-2 text-sm font-medium text-[var(--primary)] transition hover:bg-[var(--primary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            + 添加 OpenAI 兼容模型
          </button>
        </div>
      </div>
    </div>
  );
}

interface ModelFormProps {
  draft: Partial<ModelConfig>;
  onChange: (draft: Partial<ModelConfig>) => void;
  onSave: () => void;
  onCancel: () => void;
}

function ModelForm({ draft, onChange, onSave, onCancel }: ModelFormProps) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">显示名称</label>
        <input
          type="text"
          value={draft.name ?? ""}
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
          placeholder="例如：SiliconFlow"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none transition focus:border-[var(--primary-light)] focus:ring-2 focus:ring-[var(--primary-bg)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Base URL</label>
        <input
          type="text"
          value={draft.baseUrl ?? ""}
          onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })}
          placeholder="https://api.openai.com/v1"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none transition focus:border-[var(--primary-light)] focus:ring-2 focus:ring-[var(--primary-bg)]"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">API Key</label>
        <input
          type="password"
          value={draft.apiKey ?? ""}
          onChange={(e) => onChange({ ...draft, apiKey: e.target.value })}
          placeholder="sk-..."
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none transition focus:border-[var(--primary-light)] focus:ring-2 focus:ring-[var(--primary-bg)]"
        />
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          仅保存在当前会话内存中，后续将委托主进程安全存储
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">Model</label>
        <input
          type="text"
          value={draft.model ?? ""}
          onChange={(e) => onChange({ ...draft, model: e.target.value })}
          placeholder="gpt-4o"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2 text-sm outline-none transition focus:border-[var(--primary-light)] focus:ring-2 focus:ring-[var(--primary-bg)]"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--text-main)]">
        <input
          type="checkbox"
          checked={draft.isOpenAiCompatible ?? true}
          onChange={(e) => onChange({ ...draft, isOpenAiCompatible: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-[var(--primary)] focus:ring-[var(--primary-light)]"
        />
        OpenAI 兼容格式
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-4 py-2 text-sm text-[var(--text-muted)] transition hover:bg-[var(--primary-bg)]"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onSave}
          className="rounded-full bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white shadow-[var(--shadow-teal-glow)] transition hover:bg-[var(--primary-dark)] active:scale-95"
        >
          保存
        </button>
      </div>
    </div>
  );
}
