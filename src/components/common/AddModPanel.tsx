import { useMemo, useState } from "react";
import type { ModInfo } from "../../lib/types";
import MemberModList from "../ModList/MemberModList";

interface Props {
  /** All read mods (pool) */
  mods: ModInfo[];
  /** Target member keys (already in the container) — disabled in the list */
  existingKeys: Set<string>;
  /** Container label (e.g. 方案 B / 集合 C) */
  targetLabel: string;
  onAdd: (modKeys: string[]) => void;
  onClose: () => void;
}

/**
 * Add-mods panel — full reuse of the read-Mods filter/view/card stack
 * (search / enabled / source / tags incl. user tags / view toggle / ModCard),
 * plus per-card checkbox selection.
 */
export default function AddModPanel({ mods, existingKeys, targetLabel, onAdd, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const selectedKeys = useMemo(() => selected, [selected]);

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[860px] max-w-[95vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-200">添加 Mod 到「{targetLabel}」</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">
            ×
          </button>
        </div>

        {/* Full filter/view/card stack (shared with read-Mods page) */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <MemberModList
            mods={mods}
            selectable
            selectedKeys={selectedKeys}
            onToggleSelect={toggleSelect}
            existingKeys={existingKeys}
            emptyAction={
              <p className="text-xs text-slate-600">无匹配 Mod</p>
            }
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 shrink-0">
          <span className="text-xs text-slate-500">
            已选 {selected.size} 个
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={() => {
                onAdd([...selected]);
                onClose();
              }}
              disabled={selected.size === 0}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded cursor-pointer"
            >
              加入选中 ({selected.size})
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
