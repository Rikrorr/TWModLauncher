import { useEffect, useMemo, useRef, useState } from "react";
import type { ModInfo } from "../../lib/types";

// ─── Constants ───────────────────────────────────────────────────────────────

export const FILTER_CATEGORIES = [
  { key: "ws-normal", label: "创意工坊 正常", source: 1, residual: false },
  { key: "ws-residual", label: "创意工坊 残留", source: 1, residual: true },
  { key: "local-normal", label: "本地 正常", source: 0, residual: false },
  { key: "local-residual", label: "本地 残留", source: 0, residual: true },
] as const;

export type CategoryKey = (typeof FILTER_CATEGORIES)[number]["key"];
export type ViewMode = "detailed" | "compact";
export type EnabledFilter = "all" | "enabled" | "disabled";

const PREFS_KEY = "twm-filter-prefs";

interface CachedPrefs {
  activeCategories: CategoryKey[];
  tagMode: "or" | "and";
  viewMode: ViewMode;
  displayOrder: string[];
}

function loadPrefs(): CachedPrefs | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CachedPrefs;
  } catch {
    return null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useModListState(mods: ModInfo[]) {
  // Search
  const [search, setSearch] = useState("");

  // Enabled/disabled toggle
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const cycleEnabledFilter = () => {
    setEnabledFilter((prev) => {
      if (prev === "all") return "enabled";
      if (prev === "enabled") return "disabled";
      return "all";
    });
  };

  // Category multi-select
  const [activeCategories, setActiveCategories] = useState<Set<CategoryKey>>(() => {
    const cached = loadPrefs();
    if (cached?.activeCategories) return new Set(cached.activeCategories);
    return new Set(
      FILTER_CATEGORIES.filter((c) => !c.residual).map((c) => c.key),
    );
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

  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const cached = loadPrefs();
    return cached?.viewMode ?? "detailed";
  });

  // Display order (custom card ordering)
  const [displayOrder, setDisplayOrder] = useState<string[]>(() => {
    const cached = loadPrefs();
    return cached?.displayOrder ?? [];
  });

  // Sync displayOrder when mods change
  useEffect(() => {
    setDisplayOrder((prev) => {
      const allKeys = mods.map((m) => `${m.source}_${m.fileId}`);
      if (allKeys.length === 0) return prev;
      const filtered = prev.filter((k) => allKeys.includes(k));
      const existing = new Set(filtered);
      for (const k of allKeys) {
        if (!existing.has(k)) filtered.push(k);
      }
      if (
        filtered.length === prev.length &&
        filtered.every((k, i) => k === prev[i])
      ) {
        return prev;
      }
      return filtered;
    });
  }, [mods]);

  // All unique tags across all mods
  const allTags = useMemo(() => {
    const set = new Set<string>();
    mods.forEach((m) => m.tagList.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [mods]);

  // Close dropdowns on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        catDropdownRef.current &&
        !catDropdownRef.current.contains(e.target as Node)
      ) {
        setCatDropdownOpen(false);
      }
      if (
        tagDropdownRef.current &&
        !tagDropdownRef.current.contains(e.target as Node)
      ) {
        setTagDropdownOpen(false);
      }
    };
    if (catDropdownOpen || tagDropdownOpen) {
      document.addEventListener("mousedown", handler);
    }
    return () => document.removeEventListener("mousedown", handler);
  }, [catDropdownOpen, tagDropdownOpen]);

  // Persist filter prefs
  useEffect(() => {
    try {
      localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          activeCategories: [...activeCategories],
          tagMode,
          viewMode,
          displayOrder,
        }),
      );
    } catch {
      /* quota exceeded — ignore */
    }
  }, [activeCategories, tagMode, viewMode, displayOrder]);

  return {
    // Search
    search,
    setSearch,
    // Enabled filter
    enabledFilter,
    cycleEnabledFilter,
    // Category
    activeCategories,
    setActiveCategories,
    catDropdownOpen,
    setCatDropdownOpen,
    catDropdownRef,
    // Tag
    activeTags,
    setActiveTags,
    tagMode,
    setTagMode,
    tagDropdownOpen,
    setTagDropdownOpen,
    tagDropdownRef,
    allTags,
    // View
    viewMode,
    setViewMode,
    // Display order
    displayOrder,
    setDisplayOrder,
  };
}
