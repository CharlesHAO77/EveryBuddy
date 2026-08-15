import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUIStore } from "../stores/uiStore";
import { IconCheck, IconChevronDown } from "./icons";

interface ModelSelectorProps {
  selectedId?: string | null;
  onSelect: (providerId: string) => void;
  onOpenSettings: () => void;
}

export function ModelSelector({ selectedId, onSelect, onOpenSettings }: ModelSelectorProps) {
  const { t } = useTranslation();
  const models = useUIStore((s) => s.models);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 聊天下拉只列可对话模型（LLM + VLM），image 专用不可作为聊天模型
  const chatModels = models.filter((m) => m.type !== "image");
  const selectedModel = chatModels.find((m) => m.id === selectedId);
  const effectiveId = selectedModel ? selectedModel.id : chatModels[0]?.id;
  const displayName = selectedModel?.name ?? chatModels[0]?.name ?? t("model.configureFirst");

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const handleTriggerClick = () => {
    if (chatModels.length === 0) {
      onOpenSettings();
      return;
    }
    setOpen((v) => !v);
  };

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleTriggerClick}
        className="flex items-center gap-[5px] rounded-s px-2 py-[5px] text-[12px] transition bg-hover text-ink-2 hover:bg-active hover:text-ink"
      >
        {displayName}
        {chatModels.length > 0 && (
          <IconChevronDown size={10} strokeWidth={2} title={t("common.expand")} />
        )}
      </button>

      {open && chatModels.length > 0 && (
        <div className="absolute bottom-full right-0 z-50 mb-[6px] w-[180px] rounded-m border border-line bg-card py-1 shadow-pop">
          <div className="px-3 pb-1 pt-1 text-[11px] tracking-wide text-ink-3">
            {t("model.title")}
          </div>
          {chatModels.map((m) => {
            const isSelected = m.id === effectiveId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelect(m.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition ${
                  isSelected
                    ? "bg-accent-tint font-semibold text-accent-strong"
                    : "text-ink-2 hover:bg-hover"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate">{m.name}</span>
                  {m.capabilities?.vision && (
                    <span className="shrink-0 rounded-full bg-accent-tint px-1.5 py-px text-[10px] text-accent-strong">
                      {t("model.vision")}
                    </span>
                  )}
                  {m.capabilities?.imageGen && (
                    <span className="shrink-0 rounded-full bg-accent-tint px-1.5 py-px text-[10px] text-accent-strong">
                      {t("model.imageGen")}
                    </span>
                  )}
                </span>
                {isSelected && (
                  <IconCheck
                    size={12}
                    strokeWidth={2.5}
                    className="shrink-0"
                    title={t("model.selected")}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
