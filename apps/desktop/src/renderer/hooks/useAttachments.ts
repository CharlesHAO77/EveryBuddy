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
import type { AttachmentRef } from "@everybuddy/ipc-contract";
import { useRef, useState } from "react";

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

  /** 把 File 读为 data URL（剪贴板内存图片无真实路径时用） */
  const readFileAsDataURL = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  /**
   * 输入框直接粘贴：剪贴板里的图片加入附件。
   *  - 有真实路径的（如从文件管理器复制的文件）直接按原路径加入；
   *  - 剪贴板内存图片（截图/从图片工具复制）读为 base64，经 system:stage-pasted-file
   *    暂存为临时文件再按路径加入（发送时由 stageAttachments 复制到 uploads/）。
   * 仅当剪贴板含图片时才拦截（preventDefault），否则放行普通文本粘贴。
   */
  const handlePaste = async (e: React.ClipboardEvent) => {
    const files: File[] = [];
    for (const item of Array.from(e.clipboardData?.items ?? [])) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return; // 非图片 → 不拦截，正常粘贴文本
    e.preventDefault();

    const seen = new Set(attachments.map((a) => a.path));
    const next: AttachmentItem[] = [];
    for (const file of images) {
      if (next.length + attachments.length >= MAX_ATTACHMENTS) break;
      const realPath = window.electronAPI.system.getPathForFile(file);
      if (realPath) {
        if (seen.has(realPath)) continue;
        seen.add(realPath);
        next.push({
          id: crypto.randomUUID(),
          name: file.name || "paste.png",
          path: realPath,
          size: file.size,
          mimeType: file.type,
        });
        continue;
      }
      // 剪贴板内存图片：base64 暂存为临时文件后按路径加入
      try {
        const dataUrl = await readFileAsDataURL(file);
        const tempPath = await window.electronAPI.system.stagePastedFile({
          name: file.name || "paste.png",
          mimeType: file.type,
          data: dataUrl.split(",")[1] ?? "",
        });
        if (!tempPath || seen.has(tempPath)) continue;
        seen.add(tempPath);
        next.push({
          id: crypto.randomUUID(),
          name: file.name || "paste.png",
          path: tempPath,
          size: file.size,
          mimeType: file.type,
        });
      } catch (err) {
        console.error("[paste] 剪贴板图片暂存失败:", err);
      }
    }
    if (next.length > 0) setAttachments((prev) => [...prev, ...next]);
  };

  return {
    attachments,
    openPicker,
    removeAttachment,
    clear,
    handlePaste,
    fileInputProps: {
      ref: inputRef,
      className: "hidden",
      onChange: handleInputChange,
    },
    onContainerDragOver,
    onContainerDrop,
  };
}
