import { create } from "zustand";

export type CategoryId = "daily" | "coding" | "design";

export interface ModelConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  isOpenAiCompatible: boolean;
}

interface UIState {
  activeCategory: CategoryId;
  setActiveCategory: (category: CategoryId) => void;

  isModelSettingsOpen: boolean;
  setModelSettingsOpen: (open: boolean) => void;

  models: ModelConfig[];
  currentModelId: string | null;
  addModel: (model: ModelConfig) => void;
  removeModel: (id: string) => void;
  setCurrentModel: (id: string) => void;
  updateModel: (id: string, patch: Partial<ModelConfig>) => void;
}

const defaultModel: ModelConfig = {
  id: "default",
  name: "OpenAI Compatible",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o",
  isOpenAiCompatible: true,
};

export const useUIStore = create<UIState>((set) => ({
  activeCategory: "daily",
  setActiveCategory: (category) => set({ activeCategory: category }),

  isModelSettingsOpen: false,
  setModelSettingsOpen: (open) => set({ isModelSettingsOpen: open }),

  models: [defaultModel],
  currentModelId: defaultModel.id,

  addModel: (model) => set((state) => ({ models: [...state.models, model] })),

  removeModel: (id) =>
    set((state) => ({
      models: state.models.filter((m) => m.id !== id),
      currentModelId: state.currentModelId === id ? null : state.currentModelId,
    })),

  setCurrentModel: (id) => set({ currentModelId: id }),

  updateModel: (id, patch) =>
    set((state) => ({
      models: state.models.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
}));
