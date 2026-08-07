/**
 * useAttachments - 输入框附件选择/拖拽状态管理。
 *
 * 统一处理两种入口：
 *  - "+" 按钮触发隐藏 <input type="file" multiple>（openPicker）
 *  - 拖拽文件到输入容器（onContainerDragOver / onContainerDrop）
 *
 * 现代 Electron 已移除 File.path，路径经 preload 暴露的
 * webUtils.getPathForFile(file) 取得；空路径（非真实文件）与已存在路径去重，
 * 拖入的文件夹（size=0 且无 type）跳过。
 */
import { useRef, useState } from "react";
import type { AttachmentRef } from "@everybuddy/ipc-contract";

export interface AttachmentItem extends AttachmentRef {
  id: string;
}

/** 单个输入框最多附件数 */
const MAX_ATTACHMENTS = 10;

export function useAttachments() {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = (files: FileList | File[]) => {
    const seen = new Set(attachments.map((a) => a.path));
    const next: AttachmentItem[] = [];
    for (const file of Array.from(files)) {
      if (next.length + attachments.length >= MAX_ATTACHMENTS) break;
      // 过滤拖入的文件夹（无 size 且无 type）
      if (file.size === 0 && file.type === "") continue;
      const path = window.electronAPI.system.getPathForFile(file);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      next.push({
        id: crypto.randomUUID(),
        name: file.name,
        path,
        size: file.size,
        mimeType: file.type,
      });
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  };

  const openPicker = () => inputRef.current?.click();

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const clear = () => setAttachments([]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = ""; // 允许再次选择同一文件
  };

  const onContainerDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onContainerDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  return {
    attachments,
    openPicker,
    removeAttachment,
    clear,
    fileInputProps: {
      ref: inputRef,
      className: "hidden",
      onChange: handleInputChange,
    },
    onContainerDragOver,
    onContainerDrop,
  };
}
