import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./i18n";
import "./styles/globals.css";

// 沉浸式/自定义标题栏：在 <html> 标记平台，
// 供 CSS 区分顶栏布局（mac 红绿灯让位；win 自定义标题栏拖动条；见 globals.css .titlebar-drag）
if (navigator.userAgent.includes("Mac")) {
  document.documentElement.dataset.platform = "mac";
} else if (navigator.userAgent.includes("Windows")) {
  document.documentElement.dataset.platform = "win";
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
