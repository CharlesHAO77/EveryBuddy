import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  danger?: boolean;
  onSelect: () => void;
}

interface ActionMenuProps {
  items: MenuItem[];
}

const MoreIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <title>更多操作</title>
    <circle cx="12" cy="5" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="12" cy="19" r="1.7" />
  </svg>
);

/**
 * 列表项 hover 出现的 ⋯ 按钮 + dropdown 菜单。
 * 关闭逻辑复用 ModelSelector 范式（click-outside / Escape），
 * 另加：侧边栏滚动即关闭（菜单相对行绝对定位，滚动后不关会错位）、底部空间不足时向上弹出。
 *
 * 注意：依赖父级行元素的 `group` class 实现 hover 出现。
 */
export function ActionMenu({ items }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
    const handleScroll = () => setOpen(false);
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && containerRef.current) {
      // 底部空间不足则向上弹出（菜单约 items.length * 32 + 12px 高）
      const rect = containerRef.current.getBoundingClientRect();
      const menuHeight = items.length * 32 + 12;
      setDropUp(rect.bottom + menuHeight > window.innerHeight - 8);
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="更多操作"
        onClick={handleTriggerClick}
        onMouseDown={(e) => e.stopPropagation()}
        className={`flex h-[20px] w-[20px] items-center justify-center rounded-[4px] text-[#999] transition hover:bg-[#e0e0e0] ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        }`}
      >
        <MoreIcon />
      </button>

      {open && (
        // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: 菜单面板仅用于拦截点击穿透（stopPropagation），非交互控件
        <div
          className={`absolute right-0 z-50 w-[140px] rounded-[8px] border border-[#e8e8e8] bg-white py-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)] ${
            dropUp ? "bottom-full mb-[2px]" : "top-full mt-[2px]"
          }`}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={`flex w-full items-center px-3 py-[6px] text-left text-[13px] transition ${
                item.danger ? "text-red-500 hover:bg-red-50" : "text-[#333] hover:bg-[#f5f5f5]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
