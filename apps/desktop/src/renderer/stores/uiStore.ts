import type { ModelProviderConfig, SaveModelRequest } from "@everybuddy/ipc-contract";
import { create } from "zustand";

export type CategoryId = "daily" | "coding";

/** 设置侧栏分区 id：通用 → 模型设置（用户确认顺序） */
export type SettingsSectionId = "models" | "general";

/** 聊天默认模型：激活 LLM → 激活 VLM → 第一个非 image 模型 */
export function getChatDefaultId(models: ModelProviderConfig[]): string | null {
  return (
    models.find((m) => m.active && m.type === "llm")?.id ??
    models.find((m) => m.active && m.type === "vlm")?.id ??
    models.find((m) => m.type !== "image")?.id ??
    null
  );
}

interface UIState {
  activeCategory: CategoryId;
  setActiveCategory: (category: CategoryId) => void;

  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;

  /** 右侧面板（待办/计划 + 预览区）开合 */
  rightPanelOpen: boolean;
  setRightPanelOpen: (open: boolean) => void;
  /** 右侧面板宽度（v1 固定默认，预留拖拽） */
  rightPanelWidth: number;
  setRightPanelWidth: (w: number) => void;

  isSettingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  settingsSection: SettingsSectionId;
  setSettingsSection: (section: SettingsSectionId) => void;

  models: ModelProviderConfig[];
  loaded: boolean;

  loadModels: () => Promise<void>;
  saveModel: (req: SaveModelRequest) => Promise<ModelProviderConfig>;
  removeModel: (id: string) => Promise<void>;
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  /** 将某模型设为该类型下的激活模型（每类型一个，持久化） */
  setActiveModel: (id: string) => Promise<void>;
}

export const useUIStore = create<UIState>((set) => ({
  activeCategory: "daily",
  setActiveCategory: (category) => set({ activeCategory: category }),

  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  rightPanelOpen: true,
  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  rightPanelWidth: 250,
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),

  isSettingsOpen: false,
  setSettingsOpen: (open) => set({ isSettingsOpen: open }),
  settingsSection: "models",
  setSettingsSection: (section) => set({ settingsSection: section }),

  models: [],
  loaded: false,

  loadModels: async () => {
    const models = await window.electronAPI.config.getModels();
    set({ models, loaded: true });
  },

  saveModel: async (req) => {
    const saved = await window.electronAPI.config.saveModel(req);
    const models = await window.electronAPI.config.getModels();
    set({ models });
    return saved;
  },

  removeModel: async (id) => {
    await window.electronAPI.config.removeModel(id);
    const models = await window.electronAPI.config.getModels();
    set({ models });
  },

  setApiKey: async (providerId, apiKey) => {
    await window.electronAPI.config.setApiKey({ providerId, apiKey });
    const models = await window.electronAPI.config.getModels();
    set({ models });
  },

  setActiveModel: async (id) => {
    await window.electronAPI.config.setActiveModel(id);
    const models = await window.electronAPI.config.getModels();
    set({ models });
  },
}));
