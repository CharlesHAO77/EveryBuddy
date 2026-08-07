/**
 * AttachmentPreview - 输入框上方的附件预览条（chips）。
 * 展示已选/已拖入文件的名称与大小，支持逐项移除；空时不渲染。
 */
import type { AttachmentItem } from "../hooks/useAttachments";
import { IconFile, IconX } from "./icons";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface AttachmentPreviewProps {
  attachments: AttachmentItem[];
  onRemove: (id: string) => void;
}

export function AttachmentPreview({ attachments, onRemove }: AttachmentPreviewProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {attachments.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-1.5 rounded-m border border-line bg-card px-2 py-1 text-[13px] text-ink-2 shadow-card"
        >
          <IconFile className="shrink-0 text-ink-3" />
          <span className="max-w-[200px] truncate" title={a.name}>
            {a.name}
          </span>
          <span className="text-ink-3">{formatFileSize(a.size)}</span>
          <button
            type="button"
            onClick={() => onRemove(a.id)}
            title="移除附件"
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded-s text-ink-3 transition hover:bg-hover hover:text-ink"
          >
            <IconX size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
