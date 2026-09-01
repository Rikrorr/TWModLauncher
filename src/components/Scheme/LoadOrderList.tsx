import { useEffect, useState } from "react";
import type { ModInfo } from "../../lib/types";

interface Props {
  /** Members in load order (enabled state already overlaid). */
  mods: ModInfo[];
  onMoveUp: (key: string) => void;
  onMoveDown: (key: string) => void;
  /** Move to a 1-based position — the mod at that position and below shift +1. */
  onMoveToPosition: (key: string, position: number) => void;
  onToggle: (fileId: number, enabled: boolean) => void;
}

function Row({
  mod,
  position,
  total,
  onMoveUp,
  onMoveDown,
  onMoveToPosition,
  onToggle,
}: {
  mod: ModInfo;
  position: number;
  total: number;
  onMoveUp: (key: string) => void;
  onMoveDown: (key: string) => void;
  onMoveToPosition: (key: string, position: number) => void;
  onToggle: (fileId: number, enabled: boolean) => void;
}) {
  const key = `${mod.source}_${mod.fileId}`;
  const [val, setVal] = useState(String(position));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external position change to local input
    setVal(String(position));
  }, [position]);

  const commit = () => {
    const n = parseInt(val, 10);
    if (isNaN(n)) {
      setVal(String(position));
      return;
    }
    onMoveToPosition(key, n);
  };

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-colors ${
        mod.enabled
          ? "border-slate-600 bg-slate-800/80"
          : "border-slate-700/50 bg-slate-800/40 opacity-70"
      }`}
    >
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
        }}
        title="输入序号 = 移动到该位置（原位置及下方自动 +1）"
        className="w-9 text-center bg-slate-700 border border-slate-600 rounded text-slate-300 text-[10px] px-1 py-0.5
                   outline-none focus:border-blue-500 transition-colors select-text tabular-nums shrink-0"
      />
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
          mod.source === 1 ? "bg-blue-500" : "bg-emerald-500"
        }`}
        title={mod.source === 1 ? "创意工坊" : "本地"}
      />
      <span className={`flex-1 truncate text-xs ${mod.enabled ? "text-slate-200" : "text-slate-400"}`}>
        {mod.title}
      </span>

      <label
        onClick={(e) => e.stopPropagation()}
        className="relative inline-flex items-center shrink-0 cursor-pointer"
        title={mod.enabled ? "点击禁用" : "点击启用"}
      >
        <input
          type="checkbox"
          checked={mod.enabled}
          onChange={(e) => onToggle(mod.fileId, e.target.checked)}
          className="sr-only peer"
        />
        <div className="w-9 h-5 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
      </label>

      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={() => onMoveUp(key)}
          disabled={position <= 1}
          title="提前一位"
          className="text-xs text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500 cursor-pointer transition-colors px-1"
        >
          ▲
        </button>
        <button
          onClick={() => onMoveDown(key)}
          disabled={position >= total}
          title="延后一位"
          className="text-xs text-slate-500 hover:text-slate-200 disabled:opacity-30 disabled:hover:text-slate-500 cursor-pointer transition-colors px-1"
        >
          ▼
        </button>
      </div>
    </div>
  );
}

/**
 * ★ v2.1: flat load-order list — the actual loading sequence, independent from
 * the grouped observation view. ▲/▼ move one slot; the number input moves the
 * mod to that 1-based position (the mod there and below shift +1).
 */
export default function LoadOrderList({ mods, onMoveUp, onMoveDown, onMoveToPosition, onToggle }: Props) {
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
        序号越小越先加载 · 输入序号 = 直接移动到该位置，原位置及下方自动 +1
      </p>
      <div className="space-y-1">
        {mods.map((m, i) => (
          <Row
            key={`${m.source}_${m.fileId}`}
            mod={m}
            position={i + 1}
            total={mods.length}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onMoveToPosition={onMoveToPosition}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}
