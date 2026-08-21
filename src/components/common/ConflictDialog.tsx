import { useEffect, useRef } from "react";
import type { ConflictGroup } from "../../hooks/useConflictDetection";

interface Props {
  modKey: string;
  modTitle: string;
  conflicts: ConflictGroup[];
  modTitles: Record<string, string>;
  onClose: () => void;
}

/** Conflict detail popup — lists all conflict groups involving one mod. */
export default function ConflictDialog({ modKey, modTitle, conflicts, modTitles, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3"
      style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-200 truncate pr-2">
          ⚡ 冲突: {modTitle}
        </span>
        <button
          onClick={onClose}
          className="text-[10px] px-1.5 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          ✕
        </button>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-2">
        {conflicts.map((c, i) => (
          <div
            key={i}
            className={`rounded border px-2 py-1.5 ${
              c.severity === "high"
                ? "border-red-800 bg-red-950/30"
                : "border-amber-800 bg-amber-950/30"
            }`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-xs">
                {c.severity === "high" ? "🔴" : "🟡"}
              </span>
              <span className="text-xs text-slate-200 font-medium">
                {c.type === "dll" ? "DLL 重复" : "设置项重复"}
              </span>
              <span className="text-[10px] font-mono text-slate-400 truncate flex-1" title={c.name}>
                {c.name}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
              {c.severity === "high"
                ? "以下 Mod 提供同名 DLL，可能为重复安装或重复打包，同时启用可能冲突："
                : "以下 Mod 定义了同名设置项（仅提示，可能为命名巧合）："}
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              {c.modKeys.map((k) => (
                <span
                  key={k}
                  className={`text-[10px] px-1.5 py-0.5 rounded ${
                    k === modKey
                      ? "bg-blue-700 text-blue-100"
                      : "bg-slate-700 text-slate-300"
                  }`}
                >
                  {modTitles[k] ?? k}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
