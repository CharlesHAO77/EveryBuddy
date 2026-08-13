/**
 * SendModeChooser - 运行中发送选择器（见 docs/plans/dialog-experience.md 特性④）。
 *
 * Agent 正在生成时用户按 Enter / 点发送不直接发送，在输入框上方弹「长条形」菜单：
 *  - 转向（打断当前）：立即停止当前生成，优先处理新指令
 *  - 排队（完成后处理）：当前生成完成后自动发送
 *  - 取消：放弃发送，保留草稿
 * 通栏横向布局（左-右撑满输入框宽），转向 / 排队各带一行简短解释，取消紧凑收尾；
 * 不预设默认选项，由用户明确选择。
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
    <div className="absolute bottom-[calc(100%+8px)] left-0 right-0 z-40 rounded-m border border-line-strong bg-card p-1.5 shadow-pop">
      <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[12px] text-ink-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-danger" />
        Agent 正在生成，如何处理这条新消息？
      </div>
      <div className="flex items-stretch gap-1">
        <button
          type="button"
          onClick={onSteer}
          className="flex flex-1 flex-col items-start gap-0.5 rounded-s px-2.5 py-1.5 text-left transition hover:bg-hover"
        >
          <span className="text-[12.5px] font-semibold text-danger-strong">转向（打断当前）</span>
          <span className="text-[11px] leading-tight text-ink-3">
            立即停止当前生成，优先处理新指令
          </span>
        </button>
        <button
          type="button"
          onClick={onQueue}
          className="flex flex-1 flex-col items-start gap-0.5 rounded-s px-2.5 py-1.5 text-left transition hover:bg-hover"
        >
          <span className="text-[12.5px] font-semibold text-ink">排队（完成后处理）</span>
          <span className="text-[11px] leading-tight text-ink-3">当前生成完成后自动发送</span>
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex shrink-0 items-center rounded-s px-2.5 py-1.5 text-[12.5px] font-semibold text-ink transition hover:bg-hover"
        >
          取消
        </button>
      </div>
    </div>
  );
}
