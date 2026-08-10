/**
 * toastStore - 轻量 toast 队列（extension_notify 等瞬时提示）。
 * 4s 自动消失；不做堆叠上限，单任务场景足够。
 */
import { create } from "zustand";

export interface Toast {
  id: string;
  message: string;
  level: "info" | "warn" | "error";
}

interface ToastState {
  toasts: Toast[];
  push: (t: { message: string; level?: "info" | "warn" | "error" }) => void;
  dismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 4000;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = crypto.randomUUID();
    set((s) => ({ toasts: [...s.toasts, { id, message: t.message, level: t.level ?? "info" }] }));
    setTimeout(() => {
      // 仅当 toast 仍存在时移除（避免误删新 toast）
      if (get().toasts.some((x) => x.id === id)) {
        set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
      }
    }, AUTO_DISMISS_MS);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
