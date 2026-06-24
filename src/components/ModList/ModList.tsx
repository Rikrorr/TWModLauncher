import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { writeModSettings } from "../../lib/tauriApi";
import { useModStore } from "../../store/useModStore";
import { useAppStore } from "../../store/useAppStore";
import type { ModInfo } from "../../lib/types";
import { collectModSettingsData, patchModSettingsLua, generateModSettingsLua } from "../../utils/generateModSettings";
import ModCard from "./ModCard";

interface Props {
  gamePath: string;
  onSelectMod: (key: string) => void;
}

type SortKey = "name" | "enabled" | "custom";

// Filter categories based on source + residual status
const FILTER_CATEGORIES = [
  { key: "ws-normal", label: "创意工坊 正常", source: 1, residual: false },
  { key: "ws-residual", label: "创意工坊 残留", source: 1, residual: true },
  { key: "local-normal", label: "本地 正常", source: 0, residual: false },
  { key: "local-residual", label: "本地 残留", source: 0, residual: true },
] as const;

type CategoryKey = (typeof FILTER_CATEGORIES)[number]["key"];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "custom", label: "自定义排序" },
  { value: "name", label: "名称" },
  { value: "enabled", label: "启用优先" },
];

const PREFS_KEY = "twm-filter-prefs";

interface FilterPrefs {
  sortKey: SortKey;
  activeCategories: CategoryKey[];
  tagMode: "or" | "and";
}

function loadPrefs(): FilterPrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FilterPrefs;
  } catch {
    return null;
  }
}

function savePrefs(prefs: FilterPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be full or unavailable
  }
}

export default function ModList({ gamePath, onSelectMod }: Props) {
  const mods = useModStore((s) => s.mods);
  const scanning = useModStore((s) => s.scanning);
  const error = useModStore((s) => s.error);
  const toggleMod = useModStore((s) => s.toggleMod);
  const setModOrder = useModStore((s) => s.setModOrder);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const templateRaw = useAppStore((s) => s.templateRaw);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    const cached = loadPrefs();
    return cached?.sortKey ?? "custom";
  });
  // Multi-select categories — only normal (non-residual) checked by default
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(() => {
    const cached = loadPrefs();
    if (cached?.activeCategories) return new Set(cached.activeCategories);
    return new Set(FILTER_CATEGORIES.filter((c) => !c.residual).map((c) => c.key));
  });
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  // Tag multi-select
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [tagMode, setTagMode] = useState<"or" | "and">(() => {
    const cached = loadPrefs();
    return cached?.tagMode ?? "or";
  });
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  // Custom display order (mod keys)
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    sourceKey: string;
    sourceIdx: number;
    currentIdx: number;
    startY: number;
    started: boolean;
  } | null>(null);
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const preventClickRef = useRef(false);
  const dragCardHeightRef = useRef(96);
  const cardPositionsRef = useRef<Map<string, { top: number; midY: number; height: number }>>(new Map());
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollSnapshotRef = useRef(0); // container.scrollTop at drag start
  const containerRectSnapshotRef = useRef<{ top: number; bottom: number }>({ top: 0, bottom: 0 });

  // Sync displayOrder when mods change (new mods appended)
  useEffect(() => {
    setDisplayOrder((prev) => {
      const allKeys = mods.map((m) => `${m.source}_${m.fileId}`);
      // Remove keys no longer in mods
      const filtered = prev.filter((k) => allKeys.includes(k));
      // Append new mods at the end
      const existing = new Set(filtered);
      for (const k of allKeys) {
        if (!existing.has(k)) filtered.push(k);
      }
      // If nothing changed, return prev to avoid re-render
      if (filtered.length === prev.length && filtered.every((k, i) => k === prev[i])) {
        return prev;
      }
      return filtered;
    });
  }, [mods]);

  // All unique tags across all mods, sorted
  const allTags = useMemo(() => {
    const set = new Set<string>();
    mods.forEach((m) => m.tagList.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [mods]);

  // Close dropdowns on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catDropdownRef.current && !catDropdownRef.current.contains(e.target as Node)) {
        setCatDropdownOpen(false);
      }
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    };
    if (catDropdownOpen || tagDropdownOpen) {
      document.addEventListener("mousedown", handler);
    }
    return () => document.removeEventListener("mousedown", handler);
  }, [catDropdownOpen, tagDropdownOpen]);

  // Persist filter preferences to localStorage
  useEffect(() => {
    savePrefs({
      sortKey,
      activeCategories: [...activeCategories],
      tagMode,
    });
  }, [sortKey, activeCategories, tagMode]);

  // Three-state toggle: all → enabled → disabled → all
  const cycleEnabledFilter = () => {
    setEnabledFilter((prev) => {
      if (prev === "all") return "enabled";
      if (prev === "enabled") return "disabled";
      return "all";
    });
  };

  const fuse = useMemo(
    () =>
      new Fuse(mods, {
        keys: ["title", "author", "description"],
        threshold: 0.4,
      }),
    [mods],
  );

  const filtered = useMemo(() => {
    let result: ModInfo[];

    // Search
    if (search.trim()) {
      result = fuse.search(search.trim()).map((r) => r.item);
    } else {
      result = [...mods];
    }

    // Category filter (source + residual status)
    result = result.filter((m) => {
      const catKey = `${m.source === 1 ? "ws" : "local"}-${m.isResidual ? "residual" : "normal"}` as CategoryKey;
      return activeCategories.has(catKey);
    });

    // Tag filter
    if (activeTags.size > 0) {
      if (tagMode === "or") {
        result = result.filter((m) =>
          m.tagList.some((t) => activeTags.has(t)),
        );
      } else {
        result = result.filter((m) =>
          [...activeTags].every((t) => m.tagList.includes(t)),
        );
      }
    }

    // Enabled/disabled filter
    if (enabledFilter === "enabled") {
      result = result.filter((m) => m.enabled);
    } else if (enabledFilter === "disabled") {
      result = result.filter((m) => !m.enabled);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.title.localeCompare(b.title, "zh");
        case "enabled":
          return (b.enabled ? 1 : 0) - (a.enabled ? 1 : 0) ||
            a.title.localeCompare(b.title, "zh");
        case "custom": {
          // Sort by user-defined displayOrder, then by name for unlisted
          const idxA = displayOrder.indexOf(`${a.source}_${a.fileId}`);
          const idxB = displayOrder.indexOf(`${b.source}_${b.fileId}`);
          const rankA = idxA === -1 ? Infinity : idxA;
          const rankB = idxB === -1 ? Infinity : idxB;
          return rankA - rankB || a.title.localeCompare(b.title, "zh");
        }
        default:
          return 0;
      }
    });

    return result;
  }, [mods, search, enabledFilter, sortKey, fuse, activeCategories, activeTags, tagMode, displayOrder]);

  const saveModSettings = useCallback(
    async () => {
      const data = collectModSettingsData(useModStore.getState().mods);
      const lua = templateRaw
        ? patchModSettingsLua(templateRaw, data)
        : generateModSettingsLua(data);

      setSaving(true);
      try {
        await writeModSettings(gamePath, lua);
      } catch (e) {
        setLastMessage(`保存失败: ${String(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [gamePath, setLastMessage, templateRaw],
  );

  const handleOrderChange = useCallback(
    (key: string, order: number) => {
      setModOrder(key, order);
      saveModSettings();
    },
    [setModOrder, saveModSettings],
  );

  // Custom drag-and-drop (mouse-based, avoids HTML5 DnD browser quirks)
  const DRAG_THRESHOLD = 5;

  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent, key: string) => {
      if (sortKey !== "custom") return;
      const idx = displayOrder.indexOf(key);
      if (idx === -1) return;
      e.preventDefault();
      preventClickRef.current = true;

      // Snapshot all card positions BEFORE placeholder changes layout
      if (listRef.current) {
        // Find the actual scrollable container (the overflow-y-auto parent)
        let el: HTMLElement | null = listRef.current.parentElement;
        while (el) {
          const style = window.getComputedStyle(el);
          if (style.overflowY === "auto" || style.overflowY === "scroll") break;
          el = el.parentElement;
        }
        scrollContainerRef.current = el;

        const positions = new Map<string, { top: number; midY: number; height: number }>();
        const children = listRef.current.querySelectorAll("[data-mod-key]");
        children.forEach((child) => {
          const k = child.getAttribute("data-mod-key")!;
          const rect = child.getBoundingClientRect();
          positions.set(k, { top: rect.top, midY: rect.top + rect.height / 2, height: rect.height });
        });
        cardPositionsRef.current = positions;
        scrollSnapshotRef.current = el ? el.scrollTop : 0;
        if (el) {
          const cr = el.getBoundingClientRect();
          containerRectSnapshotRef.current = { top: cr.top, bottom: cr.bottom };
        }
        // Use the dragged card's measured height for placeholder
        const draggedPos = positions.get(key);
        if (draggedPos) dragCardHeightRef.current = draggedPos.height;
      }

      setDragState({
        sourceKey: key,
        sourceIdx: idx,
        currentIdx: idx,
        startY: e.clientY,
        started: false,
      });
    },
    [sortKey, displayOrder],
  );

  // Attach global mousemove/mouseup via useEffect to avoid missing events
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      const dy = Math.abs(e.clientY - ds.startY);
      if (!ds.started && dy < DRAG_THRESHOLD) return;

      const container = scrollContainerRef.current;

      // Auto-scroll when dragging near scroll-container edges
      const SCROLL_ZONE = 80;
      const SCROLL_SPEED = 12;
      if (container) {
        const cr = containerRectSnapshotRef.current;
        const topEdge = cr.top + SCROLL_ZONE;
        const bottomEdge = cr.bottom - SCROLL_ZONE;
        if (e.clientY < topEdge) {
          const speed = ((topEdge - e.clientY) / SCROLL_ZONE) * SCROLL_SPEED;
          container.scrollBy(0, -speed);
        } else if (e.clientY > bottomEdge) {
          const speed = ((e.clientY - bottomEdge) / SCROLL_ZONE) * SCROLL_SPEED;
          container.scrollBy(0, speed);
        }
      }

      // Use snapshotted positions so placeholder layout changes don't cause flicker
      // Adjust for scroll that happened since snapshot (auto-scroll + manual wheel)
      const scrollDelta = container ? container.scrollTop - scrollSnapshotRef.current : 0;
      const positions = cardPositionsRef.current;
      let closestKey: string | null = null;
      let closestDist = Infinity;
      positions.forEach((pos, k) => {
        const adjustedMidY = pos.midY - scrollDelta;
        const dist = Math.abs(e.clientY - adjustedMidY);
        if (dist < closestDist) {
          closestDist = dist;
          closestKey = k;
        }
      });

      if (!closestKey) return;
      const displayIdx = displayOrder.indexOf(closestKey);
      if (displayIdx === -1) return;

      setDragState((prev) =>
        prev
          ? {
              ...prev,
              started: true,
              currentIdx: displayIdx !== prev.currentIdx ? displayIdx : prev.currentIdx,
            }
          : null,
      );
    };

    const handleMouseUp = () => {
      const ds = dragStateRef.current;
      setDragState(null);
      if (ds?.started) {
        // Drag occurred — suppress the pending click, clear flag after event
        setTimeout(() => {
          preventClickRef.current = false;
        }, 0);
        if (ds.sourceIdx !== ds.currentIdx) {
          setDisplayOrder((prev) => {
            const next = [...prev];
            const [item] = next.splice(ds.sourceIdx, 1);
            next.splice(ds.currentIdx, 0, item);
            return next;
          });
        }
      } else {
        // No movement — allow the click to proceed
        preventClickRef.current = false;
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, displayOrder]);

  const handleToggle = useCallback(
    async (fileId: number, enabled: boolean) => {
      toggleMod(fileId, enabled);

      const updatedMods = useModStore.getState().mods;
      const data = collectModSettingsData(updatedMods);
      // Patch original raw template to preserve exact game format
      const lua = templateRaw
        ? patchModSettingsLua(templateRaw, data)
        : generateModSettingsLua(data);

      setSaving(true);
      try {
        await writeModSettings(gamePath, lua);
      } catch (e) {
        toggleMod(fileId, !enabled);
        setLastMessage(`保存失败: ${String(e)}`);
      } finally {
        setSaving(false);
      }
    },
    [gamePath, toggleMod, setLastMessage, templateRaw],
  );

  const enabledCount = mods.filter((m) => m.enabled).length;

  if (scanning) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <svg
          className="animate-spin w-8 h-8 text-blue-400"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <p className="text-sm text-slate-400">正在扫描 Mod...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (mods.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <p className="text-sm text-slate-500">未发现任何 Mod</p>
        <p className="text-xs text-slate-600">
          请确认游戏路径正确，且已安装 Mod 至 Workshop 或 Mod 目录
        </p>
      </div>
    );
  }

  return (
    <div ref={listRef} className="flex flex-col gap-3">
      {/* Search / Filter / Sort bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 Mod 名称、作者、描述..."
            className="w-full text-xs px-3 py-1.5 pl-7 bg-slate-800 border border-slate-600
                       rounded text-slate-200 outline-none focus:border-blue-500 transition-colors"
          />
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        <button
          onClick={cycleEnabledFilter}
          title="快速筛选：全部 / 已启用 / 已禁用"
          className={`text-xs px-2 py-1.5 rounded border cursor-pointer shrink-0 transition-colors ${
            enabledFilter === "all"
              ? "border-slate-500 text-slate-300 bg-slate-700"
              : enabledFilter === "enabled"
                ? "border-green-600 text-green-300 bg-green-900/40"
                : "border-amber-600 text-amber-300 bg-amber-900/40"
          }`}
        >
          {enabledFilter === "all" ? "全部" : enabledFilter === "enabled" ? "已启用" : "已禁用"}
        </button>

        {/* Category multi-select dropdown */}
        <div className="relative shrink-0" ref={catDropdownRef}>
          <button
            onClick={() => setCatDropdownOpen((v) => !v)}
            className="text-xs px-2 py-1.5 border border-slate-600 rounded
                       text-slate-300 bg-slate-800 hover:border-slate-400
                       cursor-pointer transition-colors flex items-center gap-1"
          >
            分类
            <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {catDropdownOpen && (
            <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-30 bg-slate-800 border border-slate-600
                            rounded shadow-lg py-1 min-w-36">
              {FILTER_CATEGORIES.map((cat) => {
                const checked = activeCategories.has(cat.key);
                return (
                  <label
                    key={cat.key}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300
                               hover:bg-slate-700 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setActiveCategories((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(cat.key);
                          else next.add(cat.key);
                          return next;
                        });
                      }}
                      className="accent-blue-500"
                    />
                    {cat.label}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Tag multi-select dropdown */}
        <div className="relative shrink-0" ref={tagDropdownRef}>
          <button
            onClick={() => setTagDropdownOpen((v) => !v)}
            className={`text-xs px-2 py-1.5 border rounded
                       text-slate-300 hover:border-slate-400
                       cursor-pointer transition-colors flex items-center gap-1 ${
                         activeTags.size > 0
                           ? "border-blue-500 bg-blue-900/30"
                           : "border-slate-600 bg-slate-800"
                       }`}
          >
            标签
            {activeTags.size > 0 && (
              <span className="text-[10px] text-blue-300 ml-0.5">
                ({activeTags.size})
              </span>
            )}
            <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {tagDropdownOpen && (
            <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-30 bg-slate-800 border border-slate-600
                            rounded shadow-lg py-1 max-h-60 overflow-y-auto min-w-44">
              {allTags.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-500">暂无标签</p>
              )}
              {allTags.length > 0 && activeTags.size > 0 && (
                <div className="flex items-center gap-1 px-3 py-1 border-b border-slate-600 mb-1">
                  <span className="text-xs text-slate-500">匹配:</span>
                  <button
                    onClick={() => setTagMode("or")}
                    className={"text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors " + (tagMode === "or" ? "bg-blue-600 text-white" : "text-slate-400 hover:text-slate-200")}
                  >
                    或(OR)
                  </button>
                  <button
                    onClick={() => setTagMode("and")}
                    className={"text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors " + (tagMode === "and" ? "bg-amber-600 text-white" : "text-slate-400 hover:text-slate-200")}
                  >
                    与(AND)
                  </button>
                </div>
              )}
              {allTags.map((tag) => {
                const checked = activeTags.has(tag);
                return (
                  <label
                    key={tag}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300
                               hover:bg-slate-700 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setActiveTags((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(tag);
                          else next.add(tag);
                          return next;
                        });
                      }}
                      className="accent-blue-500"
                    />
                    {tag}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="text-xs px-2 py-1.5 bg-slate-800 border border-slate-600
                     rounded text-slate-300 outline-none cursor-pointer"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Mod cards */}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          没有匹配的 Mod
        </p>
      ) : (
        (() => {
          const isCustomSort = sortKey === "custom";
          const ds = isCustomSort ? dragState : null;
          const active = ds?.started;

          // Map displayOrder currentIdx to filtered index for slot placement
          let slotFilteredIdx = -1;
          if (active && ds!.sourceIdx !== ds!.currentIdx) {
            const targetKey = displayOrder[ds!.currentIdx];
            if (targetKey) {
              slotFilteredIdx = filtered.findIndex(
                (m) => `${m.source}_${m.fileId}` === targetKey,
              );
            }
          }

          return filtered.map((mod, index) => {
            const key = `${mod.source}_${mod.fileId}`;
            const dragging = active && ds!.sourceKey === key;

            return (
              <div key={key}>
                {/* Slot indicator — matches dragged card height */}
                {index === slotFilteredIdx && (
                  <div
                    className="rounded-lg border-2 border-blue-500 border-dashed bg-blue-950/20 animate-pulse"
                    style={{ height: dragCardHeightRef.current }}
                  />
                )}
                <div
                  data-mod-key={key}
                  className={
                    dragging ? "scale-[0.98] opacity-40 z-10 relative transition-all duration-200" : ""
                  }
                >
                  <ModCard
                    mod={mod}
                    disabled={saving}
                    onToggle={handleToggle}
                    onSelect={() => {
                      if (preventClickRef.current) return;
                      onSelectMod(key);
                    }}
                    onOrderUp={(e) => {
                      e.stopPropagation();
                      setModOrder(key, mod.order + 1);
                      saveModSettings();
                    }}
                    onOrderDown={(e) => {
                      e.stopPropagation();
                      setModOrder(key, Math.max(0, mod.order - 1));
                      saveModSettings();
                    }}
                    onOrderChange={(order) => handleOrderChange(key, order)}
                    onDragMouseDown={isCustomSort ? handleDragMouseDown : undefined}
                    isDragging={dragging}
                    isDragOver={false}
                  />
                </div>
              </div>
            );
          });
        })()
      )}

      {/* Footer stats */}
      <div className="flex items-center justify-between px-1 pt-2 text-xs text-slate-500">
        <span>
          共 {mods.length} 个 Mod | {enabledCount} 已启用
          {filtered.length !== mods.length && (
            <span className="text-slate-400"> | 显示 {filtered.length} 个</span>
          )}
        </span>
        {saving && (
          <span className="text-blue-400">保存中...</span>
        )}
      </div>
    </div>
  );
}
