import { useMemo } from "react";
import Fuse from "fuse.js";
import type { ModInfo } from "../../lib/types";
import { useCategoryStore } from "../../store/useCategoryStore";
import { useModListState, type CategoryKey } from "../ModList/useModListState";
import ModFilterBar from "../ModList/ModFilterBar";
import ModCard from "../ModList/ModCard";
import type { ConflictGroup } from "../../hooks/useConflictDetection";

interface Props {
  /** Member mods to display (already overlaid with container's enabled/order). */
  mods: ModInfo[];
  /** Conflict map for badges (optional). */
  conflictMap?: Map<string, ConflictGroup[]>;
  /** modKey → title map for conflict dialog (optional). */
  modTitles?: Record<string, string>;
  /** Read-only mode (collections): toggle/order disabled. */
  readOnly?: boolean;
  onToggle?: (fileId: number, enabled: boolean) => void;
  onOrderChange?: (key: string, order: number) => void;
  onContextMenu?: (e: React.MouseEvent, mod: ModInfo, key: string) => void;
  /** When provided, config page opens via this callback (key). */
  onOpenConfig?: (key: string) => void;
  /** Empty-state extra action (e.g. "添加第一个 Mod"). */
  emptyAction?: React.ReactNode;
}

/**
 * Reusable member list — full search/filter/view/card stack shared by
 * SchemesPage and CollectionsPage (same UX as the all-read ModsPage).
 */
export default function MemberModList({
  mods,
  conflictMap,
  modTitles,
  readOnly,
  onToggle,
  onOrderChange,
  onContextMenu,
  onOpenConfig,
  emptyAction,
}: Props) {
  const filter = useModListState(mods);
  const userCategories = useCategoryStore((s) => s.categories);

  // ── Filtered mods (same pipeline as ModList) ────────────────────────────
  const fuse = useMemo(
    () => new Fuse(mods, { keys: ["title", "author", "description"], threshold: 0.4 }),
    [mods],
  );

  const filtered = useMemo(() => {
    let result: ModInfo[] = filter.search.trim()
      ? fuse.search(filter.search.trim()).map((r) => r.item)
      : [...mods];

    result = result.filter((m) => {
      const catKey = `${m.source === 1 ? "ws" : "local"}-${m.isResidual ? "residual" : "normal"}` as CategoryKey;
      return filter.activeCategories.has(catKey);
    });

    if (filter.activeTags.size > 0) {
      result =
        filter.tagMode === "or"
          ? result.filter((m) => m.tagList.some((t) => filter.activeTags.has(t)))
          : result.filter((m) => [...filter.activeTags].every((t) => m.tagList.includes(t)));
    }

    if (filter.activeCatIds.size > 0) {
      const catState = useCategoryStore.getState();
      result = result.filter((m) => {
        const key = `${m.source}_${m.fileId}`;
        const cats = new Set(catState.modCats[key] ?? []);
        return [...filter.activeCatIds].every((cid) => cats.has(cid));
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
  }, [mods, filter.search, filter.enabledFilter, fuse, filter.activeCategories, filter.activeTags, filter.tagMode, filter.displayOrder, filter.activeCatIds]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Reused filter bar */}
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
        viewMode={filter.viewMode}
        onToggleViewMode={() => filter.setViewMode((v) => (v === "detailed" ? "compact" : "detailed"))}
        onApplyOrder={() => {}}
        onGroupCreateMouseDown={() => {}}
        allUserCategories={userCategories}
        activeCatIds={filter.activeCatIds}
        onToggleCatId={(catId) =>
          filter.setActiveCatIds((prev) => {
            const next = new Set(prev);
            if (next.has(catId)) next.delete(catId);
            else next.add(catId);
            return next;
          })
        }
        catFilterDropdownOpen={filter.catFilterDropdownOpen}
        onToggleCatFilterDropdown={() => filter.setCatFilterDropdownOpen((v) => !v)}
        catFilterDropdownRef={filter.catFilterDropdownRef}
      />

      {/* Member cards */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12">
            <p className="text-sm text-slate-500">
              {mods.length === 0 ? "暂无成员" : "没有匹配的 Mod"}
            </p>
            {emptyAction}
          </div>
        ) : (
          filtered.map((m) => {
            const key = `${m.source}_${m.fileId}`;
            return (
              <div
                key={key}
                onContextMenu={
                  onContextMenu ? (e) => onContextMenu(e, m, key) : undefined
                }
              >
                <ModCard
                  mod={m}
                  disabled={readOnly}
                  onToggle={(fileId, enabled) => onToggle?.(fileId, enabled)}
                  onSelect={() => {}}
                  onDoubleClick={
                    onOpenConfig ? () => onOpenConfig(key) : undefined
                  }
                  onOrderUp={
                    readOnly
                      ? undefined
                      : () => onOrderChange?.(key, m.order + 1)
                  }
                  onOrderDown={
                    readOnly
                      ? undefined
                      : () => onOrderChange?.(key, Math.max(0, m.order - 1))
                  }
                  onOrderChange={
                    readOnly ? undefined : (order) => onOrderChange?.(key, order)
                  }
                  conflicts={conflictMap?.get(key)}
                  modTitles={modTitles}
                  viewMode={filter.viewMode}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
