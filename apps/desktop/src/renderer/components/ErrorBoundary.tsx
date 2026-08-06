/**
 * ErrorBoundary - 全局错误边界。
 * 捕获子树 render 期间抛出的异常，显示错误而非整树白屏（见 docs/architecture.md §0.4）。
 * dev 模式附带堆栈，便于定位白屏根因。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { IconAlertTriangle } from "./icons";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] 渲染异常:", error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-paper p-8 text-center">
        <IconAlertTriangle size={28} className="text-danger" />
        <div className="text-sm font-medium text-ink">页面渲染出错</div>
        <div className="max-w-md text-[13px] text-ink-2">{error.message}</div>
        {import.meta.env.DEV && error.stack && (
          <pre className="max-h-64 max-w-2xl overflow-auto rounded-s bg-terminal px-4 py-3 text-left text-[11px] leading-relaxed text-terminal-text">
            {error.stack}
          </pre>
        )}
        <button
          type="button"
          onClick={this.handleReset}
          className="mt-2 rounded-s bg-accent px-4 py-2 text-[13px] text-white transition hover:bg-accent-strong"
        >
          重试
        </button>
      </div>
    );
  }
}
