import { useEffect, useRef, useState } from "react";
import { useUIStore } from "../stores/uiStore";

const ChevronDownSmall = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <title>展开</title>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <title>已选</title>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

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
        className="flex items-center gap-[4px] rounded-[6px] px-[8px] py-[4px] text-[12px] text-[#999] transition hover:bg-[#f0f0f0]"
      >
        {displayName}
        {models.length > 0 && <ChevronDownSmall />}
      </button>

      {open && models.length > 0 && (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-[180px] rounded-[8px] border border-[#e8e8e8] bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)]">
          {models.map((m) => {
            const isSelected = m.id === effectiveId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => handleSelect(m.id)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-[13px] transition ${
                  isSelected ? "bg-[#f0fdfa] text-[#0d9488]" : "text-[#333] hover:bg-[#f5f5f5]"
                }`}
              >
                <span className="truncate">{m.name}</span>
                {isSelected && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
