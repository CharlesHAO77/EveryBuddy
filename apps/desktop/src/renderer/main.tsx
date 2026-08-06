import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/globals.css";

// macOS 沉浸式标题栏（hiddenInset）：在 <html> 标记平台，
// 供 CSS 为顶栏红绿灯让位（见 globals.css .titlebar-drag）
if (navigator.userAgent.includes("Mac")) {
  document.documentElement.dataset.platform = "mac";
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
