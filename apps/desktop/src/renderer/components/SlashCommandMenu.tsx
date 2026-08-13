/**
 * SlashCommandMenu - / 命令建议下拉面板（照 ModelSelector dropdown 样式）。
 * 由 useSlashCommands 驱动：open + items + highlightIndex；键盘/鼠标选中走 onSelect。
 */
import type { SlashCommand } from "../slashCommands";

interface Props {
  open: boolean;
  items: SlashCommand[];
  highlightIndex: number;
  onSelect: (index: number) => void;
}

export function SlashCommandMenu({ open, items, highlightIndex, onSelect }: Props) {
  if (!open || items.length === 0) return null;
  return (
    <div className="absolute bottom-full left-0 z-50 mb-[6px] w-[240px] rounded-m border border-line bg-card py-1 shadow-pop">
      {items.map((c, i) => (
        <button
          key={c.id}
          type="button"
          onMouseEnter={() => onSelect(i)}
          onClick={() => onSelect(i)}
          className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition ${
            i === highlightIndex ? "bg-accent-tint text-accent-strong" : "text-ink-2 hover:bg-hover"
          }`}
        >
          <span className="flex min-w-0 items-center gap-2">
            <b className="shrink-0 font-semibold">/{c.id}</b>
            <span className="truncate">{c.label}</span>
          </span>
          <span className="shrink-0 text-[11px] text-ink-3">回车</span>
        </button>
      ))}
    </div>
  );
}
