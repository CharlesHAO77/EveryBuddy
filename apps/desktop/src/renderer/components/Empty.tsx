/**
 * Empty - 面板内容区的空态/占位提示（居中灰字）。
 * 供右侧面板各视图（待办/文件/预览）与 PreviewView 共用，避免循环依赖。
 */
export function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center text-[12.5px] text-ink-3">
      {text}
    </div>
  );
}
