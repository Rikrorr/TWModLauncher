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

/** Migrate old-format displayOrder (mod keys only) to unified format
 *  (mod keys + group IDs interleaved). Returns null if no migration needed. */
function migrateDisplayOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const prefs = JSON.parse(raw);
    const oldOrder: string[] | undefined = prefs.displayOrder;
    const groups: { id: string; modKeys: string[] }[] | undefined = prefs.groups;
    if (!oldOrder || !groups || groups.length === 0) return null;

    // Check if migration is needed: any group ID already in displayOrder?
    const groupIdSet = new Set(groups.map((g) => g.id));
    const hasGroupIds = oldOrder.some((k) => groupIdSet.has(k));
    if (hasGroupIds) return null; // Already migrated

    // Build map from group ID to first member's index in displayOrder
    const groupPositions: { gid: string; insertAt: number }[] = [];
    for (const g of groups) {
      let firstIdx = oldOrder.length;
      for (const mk of g.modKeys) {
        const idx = oldOrder.indexOf(mk);
        if (idx !== -1 && idx < firstIdx) firstIdx = idx;
      }
      if (firstIdx < oldOrder.length) {
        groupPositions.push({ gid: g.id, insertAt: firstIdx });
      } else {
        // Empty group or all members missing — put at end
        groupPositions.push({ gid: g.id, insertAt: oldOrder.length + groupPositions.length });
      }
    }

    // Sort by insertAt descending so later inserts don't shift earlier ones
    groupPositions.sort((a, b) => b.insertAt - a.insertAt);

    const migrated = [...oldOrder];
    for (const { gid, insertAt } of groupPositions) {
      migrated.splice(Math.min(insertAt, migrated.length), 0, gid);
    }

    console.info(
      "[migrate] unified displayOrder: merged",
      groupPositions.length,
      "groups into displayOrder",
    );
    return migrated;
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

  // Display order (custom ordering — mod keys + group IDs interleaved)
  const [displayOrder, setDisplayOrder] = useState<string[]>(() => {
    const migrated = migrateDisplayOrder();
    if (migrated) return migrated;
    const cached = loadPrefs();
    return cached?.displayOrder ?? [];
  });

  // Sync displayOrder when mods change.
  // Only operates on mod keys — group IDs are preserved as-is.
  useEffect(() => {
    setDisplayOrder((prev) => {
      const allModKeys = new Set(mods.map((m) => `${m.source}_${m.fileId}`));
      if (allModKeys.size === 0) return prev;
      // Filter out stale mod keys, keep group IDs and valid mod keys
      const filtered = prev.filter((k) => {
        // Group IDs start with a dash or are UUID format — they don't contain underscore
        // like mod keys ("source_fileId")
        if (!k.includes("_")) return true; // group ID, keep
        return allModKeys.has(k); // mod key, keep if still exists
      });
      // Append new mod keys not yet in the list
      const existing = new Set(filtered);
      for (const k of allModKeys) {
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
