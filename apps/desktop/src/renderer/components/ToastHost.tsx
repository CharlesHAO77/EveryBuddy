/**
 * ToastHost - 渲染 toastStore 队列（extension_notify 瞬时提示）。
 * 固定右上角堆叠，每条带独立关闭按钮，4s 自动消失（见 toastStore）。
 */
import { useToastStore } from "../stores/toastStore";

const LEVEL_STYLE: Record<string, string> = {
  info: "border-line text-ink",
  warn: "border-line text-ink",
  error: "border-danger/40 bg-danger/5 text-danger",
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[300px] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto flex items-start justify-between gap-2 rounded-l border bg-card px-3 py-2 text-[13px] leading-snug shadow-card ${
            LEVEL_STYLE[t.level] ?? LEVEL_STYLE.info
          }`}
        >
          <span className="min-w-0 whitespace-pre-wrap">{t.message}</span>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="关闭"
            className="shrink-0 rounded-s text-ink-3 transition hover:bg-hover hover:text-ink"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
