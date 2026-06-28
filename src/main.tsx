import { flushCrashBackup, logger } from "./lib/logger";
import ErrorBoundary from "./components/ErrorBoundary";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Recover any crash-backup logs from a previous session
flushCrashBackup();

// Capture unhandled JavaScript errors
window.onerror = (_msg, _src, _line, _col, error) => {
  logger.error(
    `Unhandled error: ${error?.message ?? String(_msg)} at ${_src}:${_line}:${_col}\n${error?.stack ?? ""}`,
  );
  return false; // let default console.error also run
};

// Capture unhandled Promise rejections
window.onunhandledrejection = (event) => {
  const reason = event.reason;
  logger.error(
    `Unhandled rejection: ${reason?.message ?? String(reason)}\n${reason?.stack ?? ""}`,
  );
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
