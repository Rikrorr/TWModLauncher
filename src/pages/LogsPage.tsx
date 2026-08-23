import { useCallback, useEffect, useState } from "react";
import { readLogs, openLogDir } from "../lib/tauriApi";
import { createLogger } from "../lib/logger";

const log = createLogger("LogsPage");

type LogLevel = "all" | "ERROR" | "WARN" | "INFO" | "DEBUG";

interface LogLine {
  raw: string;
  level: LogLevel;
}

/** Parse a log line's level from common tracing formats. */
function levelOf(line: string): LogLevel {
  if (/\bERROR\b/.test(line)) return "ERROR";
  if (/\bWARN\b/.test(line)) return "WARN";
  if (/\bDEBUG\b/.test(line)) return "DEBUG";
  return "INFO";
}

const LEVEL_COLORS: Record<string, string> = {
  ERROR: "text-red-400",
  WARN: "text-amber-300",
  INFO: "text-slate-400",
  DEBUG: "text-slate-600",
};

/** Log viewer page — read ring buffer, filter by level, copy. */
export default function LogsPage() {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState<LogLevel>("all");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const raw = await readLogs();
      const parsed: LogLine[] = raw
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((rawLine) => ({ raw: rawLine, level: levelOf(rawLine) }));
      setLines(parsed);
    } catch (e) {
      log.error(`readLogs failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = filter === "all" ? lines : lines.filter((l) => l.level === filter);

  const copyAll = async () => {
    const text = filtered.map((l) => l.raw).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const copyLine = async (raw: string) => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

  const FILTERS: LogLevel[] = ["all", "ERROR", "WARN", "INFO", "DEBUG"];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        <span className="text-sm font-medium text-slate-200">日志</span>
        <span className="text-xs text-slate-500">环形缓冲 · 最近约 300 行</span>
        <div className="flex-1" />

        {/* Level filter */}
        <div className="flex items-center gap-1">
          {FILTERS.map((lv) => (
            <button
              key={lv}
              onClick={() => setFilter(lv)}
              className={`text-[10px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
                filter === lv
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-slate-200 border border-slate-600"
              }`}
            >
              {lv}
            </button>
          ))}
        </div>

        <button
          onClick={copyAll}
          disabled={filtered.length === 0}
          className="text-xs px-2.5 py-1 border border-slate-600 text-slate-300
                     hover:border-slate-400 disabled:opacity-50 rounded cursor-pointer"
        >
          {copied ? "✓ 已复制" : "复制全部"}
        </button>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="text-xs px-2.5 py-1 border border-slate-600 text-slate-300
                     hover:border-slate-400 disabled:opacity-50 rounded cursor-pointer"
        >
          {loading ? "读取中..." : "刷新"}
        </button>
        <button
          onClick={() => openLogDir().catch(() => {})}
          className="text-xs px-2.5 py-1 border border-slate-600 text-slate-300
                     hover:border-slate-400 rounded cursor-pointer"
        >
          打开目录
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed">
        {filtered.length === 0 ? (
          <p className="text-slate-600 text-center py-8">
            {lines.length === 0 ? "暂无日志（环形缓冲为空）" : "无匹配级别的日志"}
          </p>
        ) : (
          filtered.map((l, i) => (
            <div
              key={i}
              className="flex items-start gap-2 group hover:bg-slate-800/50 rounded px-1"
            >
              <span className={`shrink-0 select-none ${LEVEL_COLORS[l.level]}`}>{l.level}</span>
              <span className={`flex-1 min-w-0 whitespace-pre-wrap break-all ${LEVEL_COLORS[l.level]}`}>
                {l.raw}
              </span>
              <button
                onClick={() => void copyLine(l.raw)}
                title="复制本行"
                className="shrink-0 text-slate-600 hover:text-slate-300 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
              >
                📋
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
