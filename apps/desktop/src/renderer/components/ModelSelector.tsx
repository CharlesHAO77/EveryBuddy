import { useEffect, useRef, useState } from "react";
import { useUIStore } from "../stores/uiStore";
import { IconCheck, IconChevronDown } from "./icons";

interface ModelSelectorProps {
  selectedId?: string | null;
  onSelect: (providerId: string) => void;
  onOpenSettings: () => void;
}

export function ModelSelector({ selectedId, onSelect, onOpenSettings }: ModelSelectorProps) {
  const models = useUIStore((s) => s.models);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedModel = models.find((m) => m.id === selectedId);
  const effectiveId = selectedModel ? selectedModel.id : models[0]?.id;
  const displayName = selectedModel?.name ?? models[0]?.name ?? "请先配置模型";

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
    if (models.length === 0) {
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
        className="flex items-center gap-[4px] rounded-s px-[8px] py-[4px] text-[12px] text-ink-3 transition hover:bg-hover hover:text-ink-2"
      >
        {displayName}
        {models.length > 0 && <IconChevronDown size={10} strokeWidth={2} title="展开" />}
      </button>

      {open && models.length > 0 && (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-[180px] rounded-m border border-line bg-card py-1 shadow-pop">
          {models.map((m) => {
            const isSelected = m.id === effectiveId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelect(m.id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition ${
                  isSelected ? "bg-accent-tint text-accent-strong" : "text-ink-2 hover:bg-hover"
                }`}
              >
                <span className="truncate">{m.name}</span>
                {isSelected && <IconCheck size={12} strokeWidth={2} title="已选" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
