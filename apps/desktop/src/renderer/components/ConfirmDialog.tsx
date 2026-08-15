import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** 支持 \n 多行 */
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 确认中禁用按钮 */
  loading?: boolean;
  /** 失败时对话框内联红字（保持打开，可重试或取消） */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** 通用确认弹窗（删除任务/移除空间等危险操作）。样式范式参照 SettingsPanel 全屏覆盖层。 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "common.delete",
  cancelLabel = "common.cancel",
  loading = false,
  error = null,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // 默认 focus 取消按钮，防误回车确认
    cancelRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, loading, onCancel]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 遮罩点击关闭是 Modal 通用模式，键盘侧由 Escape 处理
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40"
      onMouseDown={(e) => {
        // 仅点击遮罩本身才关闭（点击卡片不穿透）
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div className="w-[360px] rounded-xl bg-paper p-5 shadow-modal">
        <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
        <p className="mt-2 whitespace-pre-line text-[14px] leading-[1.6] text-ink-2">
          {description}
        </p>
        {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded-s border border-line-strong px-3 py-[6px] text-[14px] text-ink-2 transition hover:bg-hover disabled:opacity-50"
          >
            {t(cancelLabel)}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className="rounded-s bg-danger px-3 py-[6px] text-[14px] text-white transition hover:bg-danger-strong disabled:opacity-50"
          >
            {loading ? t("common.processing") : t(confirmLabel)}
          </button>
        </div>
      </div>
    </div>
  );
}
