/**
 * SendModeChooser - 运行中发送选择器（见 docs/plans/dialog-experience.md 特性④）。
 *
 * Agent 正在生成时用户按 Enter / 点发送不直接发送，弹出「转向 / 排队 / 取消」：
 *  - 转向：立即打断当前生成，优先处理新指令
 *  - 排队：当前生成完成后自动发送（默认高亮，无侵入）
 *  - 取消：放弃发送，保留草稿
 */

interface SendModeChooserProps {
  open: boolean;
  onSteer: () => void;
  onQueue: () => void;
  onCancel: () => void;
}

export function SendModeChooser({ open, onSteer, onQueue, onCancel }: SendModeChooserProps) {
  if (!open) return null;
  return (
    <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-40 rounded-m border border-line-strong bg-card p-2 shadow-pop">
      <div className="flex items-center gap-1.5 px-2 pb-2 text-[12px] text-ink-2">
        <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        Agent 正在生成，如何处理这条新消息？
      </div>
      <button
        type="button"
        onClick={onSteer}
        className="flex w-full flex-col gap-0.5 rounded-s px-2.5 py-1.5 text-left transition hover:bg-hover"
      >
        <span className="text-[13px] font-semibold text-danger-strong">转向（打断当前）</span>
        <span className="text-[11.5px] text-ink-3">立即停止当前生成，优先处理新指令</span>
      </button>
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        onClick={onQueue}
        className="flex w-full flex-col gap-0.5 rounded-s border border-accent-line bg-accent-tint px-2.5 py-1.5 text-left transition hover:bg-[#d7ebe4]"
      >
        <span className="text-[13px] font-semibold text-accent-strong">排队（完成后处理）</span>
        <span className="text-[11.5px] text-ink-3">当前生成完成后自动发送（默认推荐）</span>
      </button>
      <div className="my-1 h-px bg-line" />
      <button
        type="button"
        onClick={onCancel}
        className="flex w-full flex-col gap-0.5 rounded-s px-2.5 py-1.5 text-left transition hover:bg-hover"
      >
        <span className="text-[13px] font-semibold text-ink">取消</span>
        <span className="text-[11.5px] text-ink-3">放弃发送，保留草稿</span>
      </button>
    </div>
  );
}
