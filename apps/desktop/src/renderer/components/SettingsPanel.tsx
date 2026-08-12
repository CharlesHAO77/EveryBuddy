/**
 * SettingsPanel - 全屏设置视图（左侧设置侧栏 + 右侧内容区，见 §6.7）。
 * 分区经 SETTINGS_SECTIONS 注册表扩展；侧栏顺序：通用 → 模型设置（用户确认）。
 * 默认激活分区为「模型设置」（通用为占位）。
 */
import type { ComponentType } from "react";
import { type SettingsSectionId, useUIStore } from "../stores/uiStore";
import { type IconProps, IconSettings, IconSlidersHorizontal, IconX } from "./icons";
import { ModelSettings } from "./ModelSettings";

interface SettingsPanelProps {
  onClose: () => void;
}

export interface SettingsSectionDef {
  id: SettingsSectionId;
  label: string;
  icon: ComponentType<IconProps>;
  component: ComponentType;
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  { id: "general", label: "通用", icon: IconSlidersHorizontal, component: GeneralSettings },
  { id: "models", label: "模型设置", icon: IconSettings, component: ModelSettings },
];

/** 通用占位分区（后续主题/快捷键等设置入口） */
function GeneralSettings() {
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h2 className="text-[16px] font-semibold text-ink">通用</h2>
      <p className="text-[12px] text-ink-3">主题、快捷键等设置将在后续版本提供</p>
      <div className="flex flex-col items-center gap-2 pt-20 text-ink-3">
        <div className="text-[15px] font-semibold text-ink-2">敬请期待</div>
        <div className="text-[12px]">此分区为占位，结构已为后续设置项预留</div>
      </div>
    </div>
  );
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const section = useUIStore((s) => s.settingsSection);
  const setSection = useUIStore((s) => s.setSettingsSection);
  const active = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];
  // 注册表非空（防御 noUncheckedIndexedAccess）
  if (!active) return null;
  const ActiveComponent = active.component;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20 p-4">
      {/* 悬浮设置窗口：固定尺寸，不随分区内容变化 */}
      <div className="flex h-[600px] w-[900px] max-w-full flex-col overflow-hidden rounded-xl bg-paper shadow-modal">
        {/* 顶栏：设置标题 + 右上角关闭 */}
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-line px-4">
          <span className="text-[15px] font-semibold text-ink">设置</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-s p-1 text-ink-3 transition hover:bg-hover hover:text-ink"
          >
            <IconX size={16} title="关闭" />
          </button>
        </div>

        {/* 主体：左侧设置侧栏 + 右侧内容区 */}
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[220px] shrink-0 flex-col border-r border-line bg-paper-deep">
            <nav className="flex-1 overflow-y-auto p-2">
              {SETTINGS_SECTIONS.map((s) => {
                const Icon = s.icon;
                const isActive = s.id === section;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSection(s.id)}
                    className={`flex h-[40px] w-full items-center gap-[10px] rounded-s px-[12px] text-[14px] transition ${
                      isActive
                        ? "bg-accent-tint font-semibold text-ink"
                        : "text-ink-2 hover:bg-hover"
                    }`}
                  >
                    <Icon className={isActive ? "text-accent" : "text-ink-2"} />
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>

          {/* 右侧内容区（随分区切换，可滚动） */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <ActiveComponent />
          </div>
        </div>
      </div>
    </div>
  );
}
