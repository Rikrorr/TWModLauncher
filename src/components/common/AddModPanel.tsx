import { useMemo, useState } from "react";
import Fuse from "fuse.js";
import type { ModInfo } from "../../lib/types";
import { useModListState, type CategoryKey } from "../ModList/useModListState";
import { getUserTags } from "../../utils/userTags";
import ModFilterBar from "../ModList/ModFilterBar";
import ModCard from "../ModList/ModCard";

interface Props {
  /** All read mods (pool) */
  mods: ModInfo[];
  /** Target member keys (already in the container) — excluded from the list */
  existingKeys: Set<string>;
  /** Container label (e.g. 方案 B / 集合 C) */
  targetLabel: string;
  onAdd: (modKeys: string[]) => void;
  onClose: () => void;
}

/**
 * Add-mods panel — full reuse of the read-Mods filter/view/card stack,
 * with ModList-style single-click selection + Ctrl/Shift multi-select.
 */
export default function AddModPanel({ mods, existingKeys, targetLabel, onAdd, onClose }: Props) {
  const filter = useModListState(mods);

  // ★ Exclude mods already in the target container
  const availableMods = useMemo(
    () => mods.filter((m) => !existingKeys.has(`${m.source}_${m.fileId}`)),
    [mods, existingKeys],
  );

  // ── Filtered (same pipeline as ModList/MemberModList) ────────────────────
  const fuse = useMemo(
    () => new Fuse(availableMods, { keys: ["title", "author", "description"], threshold: 0.4 }),
    [availableMods],
  );

  const filtered = useMemo(() => {
    let result: ModInfo[] = filter.search.trim()
      ? fuse.search(filter.search.trim()).map((r) => r.item)
      : [...availableMods];

    result = result.filter((m) => {
      const catKey = `${m.source === 1 ? "ws" : "local"}-${m.isResidual ? "residual" : "normal"}` as CategoryKey;
      return filter.activeCategories.has(catKey);
    });

    if (filter.activeTags.size > 0) {
      result =
        filter.tagMode === "or"
          ? result.filter((m) => {
              const combined = [...m.tagList, ...getUserTags(m)];
              return combined.some((t) => filter.activeTags.has(t));
            })
          : result.filter((m) => {
              const combined = [...new Set([...m.tagList, ...getUserTags(m)])];
              return [...filter.activeTags].every((t) => combined.includes(t));
            });
    }

    if (filter.enabledFilter === "enabled") result = result.filter((m) => m.enabled);
    else if (filter.enabledFilter === "disabled") result = result.filter((m) => !m.enabled);

    result.sort((a, b) => {
      const idxA = filter.displayOrder.indexOf(`${a.source}_${a.fileId}`);
      const idxB = filter.displayOrder.indexOf(`${b.source}_${b.fileId}`);
      const rankA = idxA === -1 ? Infinity : idxA;
      const rankB = idxB === -1 ? Infinity : idxB;
      return rankA - rankB || a.title.localeCompare(b.title, "zh");
    });

    return result;
  }, [availableMods, filter.search, filter.enabledFilter, fuse, filter.activeCategories, filter.activeTags, filter.tagMode, filter.displayOrder]);

  // ── Selection: single-click + Ctrl toggle + Shift range ─────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchorKey, setAnchorKey] = useState<string | null>(null);

  const handleCardClick = (e: React.MouseEvent, key: string) => {
    const order = filtered.map((m) => `${m.source}_${m.fileId}`);
    setSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey && anchorKey && order.includes(anchorKey) && order.includes(key)) {
        // Shift range select within the current filtered order
        const a = order.indexOf(anchorKey);
        const b = order.indexOf(key);
        const [lo, hi] = a < b ? [a, b] : [b, a];
        next.clear();
        for (let i = lo; i <= hi; i++) next.add(order[i]);
        setAnchorKey(key);
      } else if (e.ctrlKey || e.metaKey) {
        // Ctrl toggle
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setAnchorKey(key);
      } else {
        // Single click — select just this card
        next.clear();
        next.add(key);
        setAnchorKey(key);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[860px] max-w-[95vw] max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-200">添加 Mod 到「{targetLabel}」</h2>
          <span className="text-[10px] text-slate-500 hidden sm:inline">单击选择 · Ctrl 切换 · Shift 范围</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">
            ×
          </button>
        </div>

        {/* Filter bar */}
        <ModFilterBar
          search={filter.search}
          onSearchChange={filter.setSearch}
          enabledFilter={filter.enabledFilter}
          onCycleEnabledFilter={filter.cycleEnabledFilter}
          activeCategories={filter.activeCategories}
          onToggleCategory={(key) =>
            filter.setActiveCategories((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          catDropdownOpen={filter.catDropdownOpen}
          onToggleCatDropdown={() => filter.setCatDropdownOpen((v) => !v)}
          catDropdownRef={filter.catDropdownRef}
          activeTags={filter.activeTags}
          onToggleTag={(tag) =>
            filter.setActiveTags((prev) => {
              const next = new Set(prev);
              if (next.has(tag)) next.delete(tag);
              else next.add(tag);
              return next;
            })
          }
          tagMode={filter.tagMode}
          onSetTagMode={filter.setTagMode}
          tagDropdownOpen={filter.tagDropdownOpen}
          onToggleTagDropdown={() => filter.setTagDropdownOpen((v) => !v)}
          tagDropdownRef={filter.tagDropdownRef}
          allTags={filter.allTags}
          allUserTags={filter.allUserTags}
          viewMode={filter.viewMode}
          onToggleViewMode={() => filter.setViewMode((v) => (v === "detailed" ? "compact" : "detailed"))}
          onApplyOrder={() => {}}
          onGroupCreateMouseDown={() => {}}
          hideGroupCreate
        />

        {/* Pool list — click-select cards */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">无匹配 Mod</p>
          ) : (
            filtered.map((m) => {
              const key = `${m.source}_${m.fileId}`;
              const isSelected = selected.has(key);
              return (
                <div
                  key={key}
                  onClick={(e) => handleCardClick(e, key)}
                  className={`rounded-lg transition-colors cursor-pointer ${
                    isSelected ? "ring-2 ring-blue-500 bg-blue-950/20" : ""
                  }`}
                >
                  <ModCard
                    mod={m}
                    disabled
                    onToggle={() => {}}
                    onSelect={() => {}}
                    isSelected={isSelected}
                    viewMode={filter.viewMode}
                    hideToggleAndOrder
                  />
                </div>
              );
            })
          )}
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
