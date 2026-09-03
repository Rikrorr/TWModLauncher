import type { ModInfo } from "../../lib/types";
import ModCard from "../ModList/ModCard";

interface Props {
  /** Members in load order (enabled state already overlaid, order = 0-based position). */
  mods: ModInfo[];
  onMoveUp: (key: string) => void;
  onMoveDown: (key: string) => void;
  /** Move to a 0-based position — the mod at that position and below shift +1. */
  onMoveToPosition: (key: string, position: number) => void;
  onToggle: (fileId: number, enabled: boolean) => void;
}

/**
 * ★ v2.1: flat load-order list — the actual loading sequence, independent from
 * the grouped observation view. Rows reuse the compact observation ModCard so
 * the ▲ / 序号输入 / ▼ controls (input between the arrows) behave identically.
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
        序号从 0 开始，越小越先加载 · 输入序号 = 直接移动到该位置，原位置及下方自动 +1
      </p>
      <div className="space-y-1">
        {mods.map((m) => {
          const key = `${m.source}_${m.fileId}`;
          return (
            <ModCard
              key={key}
              mod={m}
              viewMode="compact"
              onToggle={onToggle}
              onSelect={() => {}}
              onOrderUp={() => onMoveUp(key)}
              onOrderDown={() => onMoveDown(key)}
              onOrderChange={(order) => onMoveToPosition(key, order)}
            />
          );
        })}
      </div>
    </div>
  );
}
