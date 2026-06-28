/**
 * Frontend logging utility for TWModLauncher.
 *
 * Each log call sends an event to the Rust backend, which writes it to
 * the daily-rotating log file under {app_data}/TWModLauncher/logs/.
 *
 * Error-level logs are additionally saved to sessionStorage so they can
 * be recovered if the webview crashes before the invoke completes.
 */
import { invoke } from "@tauri-apps/api/core";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  target: string;
  message: string;
}

const CRASH_LOG_KEY = "__twm_crash_log__";

function now(): string {
  return new Date().toISOString();
}

function send(level: LogLevel, target: string, message: string) {
  // Fire-and-forget invoke so logging never blocks the UI
  invoke("log_event", { level, target, message }).catch(() => {});
}

function saveCrashBackup(entry: LogEntry) {
  try {
    const stored = sessionStorage.getItem(CRASH_LOG_KEY);
    const entries: LogEntry[] = stored ? JSON.parse(stored) : [];
    entries.push(entry);
    // Keep max 50 entries to avoid filling storage
    if (entries.length > 50) entries.shift();
    sessionStorage.setItem(CRASH_LOG_KEY, JSON.stringify(entries));
  } catch {
    // sessionStorage may be unavailable
  }
}

/** Flush any crash-backup logs from a previous session. Call once at startup. */
export function flushCrashBackup() {
  try {
    const stored = sessionStorage.getItem(CRASH_LOG_KEY);
    if (stored) {
      const entries: LogEntry[] = JSON.parse(stored);
      sessionStorage.removeItem(CRASH_LOG_KEY);
      for (const e of entries) {
        send(e.level, e.target, `[CRASH_BACKUP] ${e.message}`);
      }
      if (entries.length > 0) {
        send("warn", "logger", `Recovered ${entries.length} log entries from previous crash session`);
      }
    }
  } catch {
    // Ignore
  }
}

export interface Logger {
  debug: (msg: string) => void;
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
}

/** Create a logger bound to a named module target. */
export function createLogger(target: string): Logger {
  return {
    debug(msg: string) {
      send("debug", target, msg);
    },
    info(msg: string) {
      send("info", target, msg);
    },
    warn(msg: string) {
      send("warn", target, msg);
    },
    error(msg: string) {
      send("error", target, msg);
      saveCrashBackup({ ts: now(), level: "error", target, message: msg });
    },
  };
}

/** Convenience singleton for non-module-specific logs. */
export const logger = createLogger("app");
