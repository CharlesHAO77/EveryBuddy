/**
 * SettingsPanel - 全屏设置视图（左侧设置侧栏 + 右侧内容区，见 §6.7）。
 * 分区经 SETTINGS_SECTIONS 注册表扩展；侧栏顺序：通用 → 模型设置（用户确认）。
 * 默认激活分区为「模型设置」（通用为占位）。
 */
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { type SettingsSectionId, useUIStore } from "../stores/uiStore";
import { type IconProps, IconSettings, IconSlidersHorizontal, IconX } from "./icons";
import { ModelSettings } from "./ModelSettings";

interface SettingsPanelProps {
  onClose: () => void;
}

export interface SettingsSectionDef {
  id: SettingsSectionId;
  labelKey: string;
  icon: ComponentType<IconProps>;
  component: ComponentType;
}

const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: "general",
    labelKey: "settings.general",
    icon: IconSlidersHorizontal,
    component: GeneralSettings,
  },
  { id: "models", labelKey: "settings.models", icon: IconSettings, component: ModelSettings },
];

/** 通用分区：语言切换 + 后续设置项占位 */
function GeneralSettings() {
  const { t, i18n } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <h2 className="text-[16px] font-semibold text-ink">{t("settings.general")}</h2>
      <div className="mt-[14px] flex items-center gap-[8px]">
        <label htmlFor="settings-language" className="text-[14px] text-ink-2">
          {t("settings.language")}
        </label>
        <select
          id="settings-language"
          value={i18n.language}
          onChange={(e) => void i18n.changeLanguage(e.target.value)}
          className="rounded-s border border-line bg-paper px-[12px] py-[10px] text-[15px] text-ink"
        >
          <option value="zh-CN">简体中文</option>
          <option value="en">English</option>
        </select>
      </div>
      <p className="mt-[14px] text-[12px] text-ink-3">{t("settings.moreComing")}</p>
    </div>
  );
}

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const { t } = useTranslation();
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
          <span className="text-[15px] font-semibold text-ink">{t("settings.title")}</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-s p-1 text-ink-3 transition hover:bg-hover hover:text-ink"
          >
            <IconX size={16} title={t("common.close")} />
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
                    <span>{t(s.labelKey)}</span>
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
