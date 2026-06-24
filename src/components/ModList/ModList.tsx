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

type SortKey = "name" | "enabled" | "order";

// Filter categories based on source + residual status
const FILTER_CATEGORIES = [
  { key: "ws-normal", label: "创意工坊 正常", source: 1, residual: false },
  { key: "ws-residual", label: "创意工坊 残留", source: 1, residual: true },
  { key: "local-normal", label: "本地 正常", source: 0, residual: false },
  { key: "local-residual", label: "本地 残留", source: 0, residual: true },
] as const;

type CategoryKey = (typeof FILTER_CATEGORIES)[number]["key"];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "名称" },
  { value: "enabled", label: "启用优先" },
  { value: "order", label: "排序优先" },
];

export default function ModList({ gamePath, onSelectMod }: Props) {
  const mods = useModStore((s) => s.mods);
  const scanning = useModStore((s) => s.scanning);
  const error = useModStore((s) => s.error);
  const toggleMod = useModStore((s) => s.toggleMod);
  const reorderMods = useModStore((s) => s.reorderMods);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const templateRaw = useAppStore((s) => s.templateRaw);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [sortKey, setSortKey] = useState<SortKey>("order");
  // Multi-select categories — all selected by default
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(
    () => new Set(FILTER_CATEGORIES.map((c) => c.key)),
  );
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);
  const catDropdownRef = useRef<HTMLDivElement>(null);
  // Tag multi-select
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [tagMode, setTagMode] = useState<"or" | "and">("or");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);

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
        case "order":
          return (a.order || 999) - (b.order || 999);
        default:
          return 0;
      }
    });

    return result;
  }, [mods, search, enabledFilter, sortKey, fuse, activeCategories, activeTags, tagMode]);

  const handleMoveMod = useCallback(
    async (key: string, direction: -1 | 1) => {
      // Switch to order sort if not already
      if (sortKey !== "order") setSortKey("order");

      reorderMods(key, direction);

      // Save to ModSettings.Lua
      const updatedMods = useModStore.getState().mods;
      const data = collectModSettingsData(updatedMods);
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
    [gamePath, reorderMods, setLastMessage, templateRaw, sortKey],
  );

  // Compute order display (only when sorted by order)
  const orderPositions = useMemo(() => {
    if (sortKey !== "order") return null;
    const sorted = [...mods]
      .map((m, idx) => ({ m, idx }))
      .sort((a, b) => (a.m.order || 999) - (b.m.order || 999) || a.idx - b.idx);
    const map = new Map<string, { num: number; first: boolean; last: boolean }>();
    sorted.forEach((x, i) => {
      map.set(`${x.m.source}_${x.m.fileId}`, {
        num: i + 1,
        first: i === 0,
        last: i === sorted.length - 1,
      });
    });
    return map;
  }, [mods, sortKey]);

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
    <div className="flex flex-col gap-3">
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
        filtered.map((mod) => {
          const key = `${mod.source}_${mod.fileId}`;
          const orderInfo = orderPositions?.get(key);
          return (
            <ModCard
              key={key}
              mod={mod}
              disabled={saving}
              onToggle={handleToggle}
              onSelect={() => onSelectMod(key)}
              showOrder={sortKey === "order"}
              orderNum={orderInfo?.num}
              canMoveUp={orderInfo ? !orderInfo.first : false}
              canMoveDown={orderInfo ? !orderInfo.last : false}
              onMoveUp={(e) => {
                e.stopPropagation();
                handleMoveMod(key, -1);
              }}
              onMoveDown={(e) => {
                e.stopPropagation();
                handleMoveMod(key, 1);
              }}
            />
          );
        })
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
