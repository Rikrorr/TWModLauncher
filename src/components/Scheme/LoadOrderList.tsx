import type { ModInfo } from "../../lib/types";

interface Props {
  /** Members in load order (enabled state already overlaid). */
  mods: ModInfo[];
  onMoveUp: (key: string) => void;
  onMoveDown: (key: string) => void;
  onToggle: (fileId: number, enabled: boolean) => void;
}

/**
 * ★ v2.1: flat load-order list — the actual loading sequence, independent from
 * the grouped observation view. Order is changed with ▲/▼; numbers are derived
 * from list positions (MO2-style: order = list, numbers follow).
 */
export default function LoadOrderList({ mods, onMoveUp, onMoveDown, onToggle }: Props) {
  if (mods.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-slate-500">暂无成员，请先在观测模式中添加 Mod</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3">
      <p className="text-[10px] text-slate-500 mb-2">
        序号越小越先加载 · 启用状态与观测分组互不影响
      </p>
      <div className="space-y-1">
        {mods.map((m, i) => {
          const key = `${m.source}_${m.fileId}`;
          return (
            <div
              key={key}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
                m.enabled
                  ? "border-slate-600 bg-slate-800/80"
                  : "border-slate-700/50 bg-slate-800/40 opacity-70"
              }`}
            >
              <span className="w-8 text-xs text-slate-400 shrink-0 text-center tabular-nums">
                {i + 1}
              </span>
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  m.source === 1 ? "bg-blue-500" : "bg-emerald-500"
                }`}
                title={m.source === 1 ? "创意工坊" : "本地"}
              />
              <span className={`flex-1 truncate text-xs ${m.enabled ? "text-slate-200" : "text-slate-400"}`}>
                {m.title}
              </span>

              <label
                onClick={(e) => e.stopPropagation()}
                className="relative inline-flex items-center shrink-0 cursor-pointer"
                title={m.enabled ? "点击禁用" : "点击启用"}
              >
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) => onToggle(m.fileId, e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
              </label>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => onMoveUp(key)}
                  disabled={i === 0}
                  title="提前一位"
                  className="text-xs text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500 cursor-pointer transition-colors px-1"
                >
                  ▲
                </button>
                <button
                  onClick={() => onMoveDown(key)}
                  disabled={i === mods.length - 1}
                  title="延后一位"
                  className="text-xs text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500 cursor-pointer transition-colors px-1"
                >
                  ▼
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
