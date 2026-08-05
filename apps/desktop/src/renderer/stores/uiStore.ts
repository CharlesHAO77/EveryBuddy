import type { ModelProviderConfig, SaveModelRequest } from "@everybuddy/ipc-contract";
import { create } from "zustand";

export type CategoryId = "daily" | "coding";

interface UIState {
  activeCategory: CategoryId;
  setActiveCategory: (category: CategoryId) => void;

  isModelSettingsOpen: boolean;
  setModelSettingsOpen: (open: boolean) => void;

  models: ModelProviderConfig[];
  currentModelId: string | null;
  loaded: boolean;

  loadModels: () => Promise<void>;
  saveModel: (req: SaveModelRequest) => Promise<ModelProviderConfig>;
  removeModel: (id: string) => Promise<void>;
  setApiKey: (providerId: string, apiKey: string) => Promise<void>;
  setCurrentModel: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  activeCategory: "daily",
  setActiveCategory: (category) => set({ activeCategory: category }),

  isModelSettingsOpen: false,
  setModelSettingsOpen: (open) => set({ isModelSettingsOpen: open }),

  models: [],
  currentModelId: null,
  loaded: false,

  loadModels: async () => {
    const models = await window.electronAPI.config.getModels();
    const currentModelId = get().currentModelId ?? models[0]?.id ?? null;
    set({
      models,
      currentModelId,
      loaded: true,
    });
  },

  saveModel: async (req) => {
    const saved = await window.electronAPI.config.saveModel(req);
    const models = await window.electronAPI.config.getModels();
    set({ models, currentModelId: saved.id });
    return saved;
  },

  removeModel: async (id) => {
    await window.electronAPI.config.removeModel(id);
    const models = await window.electronAPI.config.getModels();
    set((state) => ({
      models,
      currentModelId: state.currentModelId === id ? (models[0]?.id ?? null) : state.currentModelId,
    }));
  },

  setApiKey: async (providerId, apiKey) => {
    await window.electronAPI.config.setApiKey({ providerId, apiKey });
    const models = await window.electronAPI.config.getModels();
    set({ models });
  },

  setCurrentModel: (id) => set({ currentModelId: id }),
}));
