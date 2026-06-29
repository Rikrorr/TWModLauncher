import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { writeModSettings } from "../../lib/tauriApi";
import { useModStore } from "../../store/useModStore";
import { useAppStore } from "../../store/useAppStore";
import { createLogger } from "../../lib/logger";
import type { ModInfo, ModGroup } from "../../lib/types";
import { collectModSettingsData, patchModSettingsLua, generateModSettingsLua } from "../../utils/generateModSettings";
import ModCard from "./ModCard";

interface Props {
  gamePath: string;
  onSelectMod: (key: string) => void;
}

// Filter categories based on source + residual status
const FILTER_CATEGORIES = [
  { key: "ws-normal", label: "创意工坊 正常", source: 1, residual: false },
  { key: "ws-residual", label: "创意工坊 残留", source: 1, residual: true },
  { key: "local-normal", label: "本地 正常", source: 0, residual: false },
  { key: "local-residual", label: "本地 残留", source: 0, residual: true },
] as const;

type CategoryKey = (typeof FILTER_CATEGORIES)[number]["key"];

const PREFS_KEY = "twm-filter-prefs";

type ViewMode = "detailed" | "compact";

interface FilterPrefs {
  sortKey: "custom";
  activeCategories: CategoryKey[];
  tagMode: "or" | "and";
  viewMode: ViewMode;
  groups: ModGroup[];
  displayOrder: string[];
  groupOrder: string[];
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

const log = createLogger("ModList");

export default function ModList({ gamePath, onSelectMod }: Props) {
  const mods = useModStore((s) => s.mods);
  const scanning = useModStore((s) => s.scanning);
  const error = useModStore((s) => s.error);
  const toggleMod = useModStore((s) => s.toggleMod);
  const setModOrder = useModStore((s) => s.setModOrder);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const templateRaw = useAppStore((s) => s.templateRaw);
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const groupOrder = useAppStore((s) => s.groupOrder);
  const setGroupOrder = useAppStore((s) => s.setGroupOrder);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
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
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const cached = loadPrefs();
    return cached?.viewMode ?? "detailed";
  });
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  // Custom display order (mod keys)
  const [displayOrder, setDisplayOrder] = useState<string[]>(() => {
    const cached = loadPrefs();
    return cached?.displayOrder ?? [];
  });
  const listRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    sourceKey: string;
    sourceIdx: number;
    currentIdx: number;
    startY: number;
    started: boolean;
    /** Group id to place the slot before (when mouse is above a group header).
     *  Takes precedence over card-based currentIdx slot. */
    slotBeforeGroupId?: string;
  } | null>(null);
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const preventClickRef = useRef(false);
  const dragCardHeightRef = useRef(96);
  const cardPositionsRef = useRef<Map<string, { top: number; midY: number; height: number }>>(new Map());
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollSnapshotRef = useRef(0); // container.scrollTop at drag start
  const containerRectSnapshotRef = useRef<{ top: number; bottom: number }>({ top: 0, bottom: 0 });
  // Group creation drag state
  const [groupCreateState, setGroupCreateState] = useState<{
    active: boolean;
    startY: number;
    slotY: number;
    insertAfter: string | null;
    insertBefore: string | null;
    groupOrderIdx: number;
  } | null>(null);
  const groupCreateRef = useRef(groupCreateState);
  groupCreateRef.current = groupCreateState;
  const groupOrderRef = useRef(groupOrder);
  groupOrderRef.current = groupOrder;
  // Group drop target during card drag
  const dragOverGroupRef = useRef<string | null>(null);
  const groupHeaderPositionsRef = useRef<Map<string, { top: number; bottom: number }>>(new Map());
  // Group header drag (same pattern as card drag)
  const [groupHeaderDragState, setGroupHeaderDragState] = useState<{
    sourceGroupId: string;
    sourceIdx: number;
    currentIdx: number;
    startY: number;
    started: boolean;
    /** Card key to place the blue slot before (card-level target). */
    slotBeforeKey?: string;
    /** If true, insert the group AFTER slotBeforeKey on drop. */
    insertAfter?: boolean;
  } | null>(null);
  const groupHeaderDragStateRef = useRef(groupHeaderDragState);
  groupHeaderDragStateRef.current = groupHeaderDragState;
  const groupHeaderHeightRef = useRef(42);
  const groupDragSlotHeightRef = useRef(42); // full group height for drag slot

  // Sync displayOrder when mods change (new mods appended)
  useEffect(() => {
    setDisplayOrder((prev) => {
      const allKeys = mods.map((m) => `${m.source}_${m.fileId}`);
      // Skip when mods haven't loaded yet — preserves cached displayOrder.
      // Otherwise filtering against an empty list would wipe the cached order.
      if (allKeys.length === 0) return prev;
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

  // Sync groupOrder with groups (remove deleted, add new at end)
  useEffect(() => {
    const groupIdSet = new Set(groups.map((g) => g.id));
    const filtered = groupOrder.filter((id) => groupIdSet.has(id));
    let changed = filtered.length !== groupOrder.length;
    for (const g of groups) {
      if (!filtered.includes(g.id)) {
        filtered.push(g.id);
        changed = true;
      }
    }
    if (changed) setGroupOrder(filtered);
  }, [groups, groupOrder, setGroupOrder]);

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
      sortKey: "custom" as const,
      activeCategories: [...activeCategories],
      tagMode,
      viewMode,
      groups,
      displayOrder,
      groupOrder,
    });
  }, [activeCategories, tagMode, viewMode, groups, displayOrder, groupOrder]);

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

    // Sort by user-defined displayOrder, then by name for unlisted
    result.sort((a, b) => {
      const idxA = displayOrder.indexOf(`${a.source}_${a.fileId}`);
      const idxB = displayOrder.indexOf(`${b.source}_${b.fileId}`);
      const rankA = idxA === -1 ? Infinity : idxA;
      const rankB = idxB === -1 ? Infinity : idxB;
      return rankA - rankB || a.title.localeCompare(b.title, "zh");
    });

    return result;
  }, [mods, search, enabledFilter, fuse, activeCategories, activeTags, tagMode, displayOrder]);

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

  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const handleDeleteGroup = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  }, []);

  const handleToggleGroup = useCallback((groupId: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.id === groupId ? { ...g, collapsed: !g.collapsed } : g,
      ),
    );
  }, []);

  const handleRenameGroup = useCallback((groupId: string, name: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.id === groupId ? { ...g, name } : g)),
    );
  }, []);

  const handleMoveToGroup = useCallback(
    (modKey: string, groupId: string | null) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id === groupId) {
            // Add to this group (if not already present)
            if (g.modKeys.includes(modKey)) return g;
            // First card added — clear the empty-group positioning anchor
            const wasEmpty = g.modKeys.length === 0;
            return {
              ...g,
              modKeys: [...g.modKeys, modKey],
              anchorBefore: wasEmpty ? undefined : g.anchorBefore,
              anchorAfter: wasEmpty ? undefined : g.anchorAfter,
            };
          }
          // Remove from other groups
          return { ...g, modKeys: g.modKeys.filter((k) => k !== modKey) };
        }),
      );
    },
    [],
  );

  // Build modKey -> group lookup
  const modGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((g) => g.modKeys.forEach((k) => map.set(k, g.id)));
    return map;
  }, [groups]);
  const modGroupMapRef = useRef(modGroupMap);
  modGroupMapRef.current = modGroupMap;

  const handleApplyOrder = useCallback(() => {
    const currentMods = useModStore.getState().mods;
    const keyModMap = new Map(currentMods.map((m) => [`${m.source}_${m.fileId}`, m]));
    const updates: [string, number][] = [];

    let nextOrder = 0;
    const emittedGroups = new Set<string>();

    // Walk displayOrder and emit mods in visual rendering order.
    // When a group is first encountered, emit ALL its members contiguously
    // (sorted by displayOrder), matching how the list is visually rendered.
    // See renderItems construction: a group cluster renders at the position
    // of its first member in displayOrder.
    for (const key of displayOrder) {
      if (!keyModMap.has(key)) continue;

      const gid = modGroupMap.get(key);
      if (gid) {
        if (emittedGroups.has(gid)) continue;
        emittedGroups.add(gid);
        const group = groups.find((g) => g.id === gid);
        if (group) {
          const sorted = group.modKeys
            .filter((mk) => keyModMap.has(mk))
            .sort((a, b) => displayOrder.indexOf(a) - displayOrder.indexOf(b));
          for (const mk of sorted) {
            const mod = keyModMap.get(mk)!;
            if (mod.enabled) {
              updates.push([mk, nextOrder++]);
            }
            keyModMap.delete(mk);
          }
        }
      } else {
        const mod = keyModMap.get(key)!;
        if (mod.enabled) {
          updates.push([key, nextOrder++]);
        }
        keyModMap.delete(key);
      }
    }

    // Remaining enabled mods not in displayOrder (newly added, etc.)
    for (const [key, mod] of keyModMap) {
      if (mod.enabled) {
        updates.push([key, nextOrder++]);
      }
    }

    for (const [key, order] of updates) {
      setModOrder(key, order);
    }
    saveModSettings();
    setLastMessage(`已应用加载顺序 — ${updates.length} 个已启用 Mod 从 0 递增`);
  }, [displayOrder, groups, modGroupMap, setModOrder, saveModSettings, setLastMessage]);

  // Custom drag-and-drop (mouse-based, avoids HTML5 DnD browser quirks)
  const DRAG_THRESHOLD = 5;

  const handleDragMouseDown = useCallback(
    (e: React.MouseEvent, key: string) => {
      const idx = displayOrder.indexOf(key);
      if (idx === -1) {
        log.debug(`[drag] mousedown skipped: key not in displayOrder ${key}`);
        return;
      }
      log.debug(`[drag] mousedown start key=${key} idx=${idx} displayOrder.length=${displayOrder.length}`);
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

        // Also snapshot group header positions for drag-to-group
        if (el) {
          const groupHeaders = new Map<string, { top: number; bottom: number }>();
          const headers = listRef.current.querySelectorAll("[data-folder-id]");
          headers.forEach((header) => {
            const gid = header.getAttribute("data-folder-id")!;
            const rect = header.getBoundingClientRect();
            groupHeaders.set(gid, { top: rect.top, bottom: rect.bottom });
          });
          groupHeaderPositionsRef.current = groupHeaders;
        }
      }

      setDragState({
        sourceKey: key,
        sourceIdx: idx,
        currentIdx: idx,
        startY: e.clientY,
        started: false,
      });
    },
    [displayOrder],
  );

  // Group header drag — same pattern as card drag
  const handleGroupHeaderDragMouseDown = useCallback(
    (e: React.MouseEvent, groupId: string) => {
      const idx = groupOrder.indexOf(groupId);
      if (idx === -1) return;
      e.preventDefault();
      preventClickRef.current = true;

      // Snapshot group header AND card positions
      if (listRef.current) {
        let el: HTMLElement | null = listRef.current.parentElement;
        while (el) {
          const style = window.getComputedStyle(el);
          if (style.overflowY === "auto" || style.overflowY === "scroll") break;
          el = el.parentElement;
        }
        scrollContainerRef.current = el;
        scrollSnapshotRef.current = el ? el.scrollTop : 0;
        if (el) {
          const cr = el.getBoundingClientRect();
          containerRectSnapshotRef.current = { top: cr.top, bottom: cr.bottom };
        }

        // Snapshot group header positions
        const groupHeaders = new Map<string, { top: number; bottom: number }>();
        const headers = listRef.current.querySelectorAll("[data-folder-id]");
        headers.forEach((header) => {
          const gid = header.getAttribute("data-folder-id")!;
          const rect = header.getBoundingClientRect();
          groupHeaders.set(gid, { top: rect.top, bottom: rect.bottom });
          if (gid === groupId) groupHeaderHeightRef.current = rect.height;
        });
        groupHeaderPositionsRef.current = groupHeaders;

        // Snapshot card positions (needed for card-level targets)
        const positions = new Map<string, { top: number; midY: number; height: number }>();
        const children = listRef.current.querySelectorAll("[data-mod-key]");
        children.forEach((child) => {
          const k = child.getAttribute("data-mod-key")!;
          const rect = child.getBoundingClientRect();
          positions.set(k, { top: rect.top, midY: rect.top + rect.height / 2, height: rect.height });
        });
        cardPositionsRef.current = positions;

        // Compute full visual height of the dragged group (header + cards)
        const ownGroup = groups.find((g) => g.id === groupId);
        const ownModKeys = new Set(ownGroup?.modKeys ?? []);
        const ownCards = [...positions.entries()].filter(([k]) => ownModKeys.has(k));
        let totalHeight = groupHeaderHeightRef.current;
        for (const [, pos] of ownCards) totalHeight += pos.height;
        groupDragSlotHeightRef.current = totalHeight;
      }

      setGroupHeaderDragState({
        sourceGroupId: groupId,
        sourceIdx: idx,
        currentIdx: idx,
        startY: e.clientY,
        started: false,
      });
    },
    [groupOrder],
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

      // Find closest card, but only among valid targets:
      // - Ungrouped card dragged → only ungrouped cards are valid targets
      // - Grouped card dragged → same-group cards or ungrouped cards are valid
      const currentGroupMap = modGroupMapRef.current;
      const draggedGroupId = currentGroupMap.get(ds.sourceKey) ?? null;

      let closestKey: string | null = null;
      let closestDist = Infinity;
      positions.forEach((pos, k) => {
        if (k === ds.sourceKey) return; // skip self
        const targetGroupId = currentGroupMap.get(k) ?? null;
        if (draggedGroupId) {
          if (targetGroupId !== draggedGroupId && targetGroupId !== null) return;
        } else {
          if (targetGroupId !== null) return;
        }
        const adjustedMidY = pos.midY - scrollDelta;
        const dist = Math.abs(e.clientY - adjustedMidY);
        if (dist < closestDist) {
          closestDist = dist;
          closestKey = k;
        }
      });

      // Fallback: if no valid target found (e.g. mouse above all cards in zone
      // or between groups), use the first/last valid card based on mouse Y.
      if (!closestKey) {
        const validKeys: { key: string; y: number }[] = [];
        positions.forEach((pos, k) => {
          if (k === ds.sourceKey) return;
          const gid = currentGroupMap.get(k) ?? null;
          if (draggedGroupId) {
            if (gid !== draggedGroupId && gid !== null) return;
          } else {
            if (gid !== null) return;
          }
          validKeys.push({ key: k, y: pos.midY - scrollDelta });
        });
        validKeys.sort((a, b) => a.y - b.y);
        if (validKeys.length > 0) {
          if (e.clientY <= validKeys[0].y) {
            closestKey = validKeys[0].key;
          } else {
            closestKey = validKeys[validKeys.length - 1].key;
          }
        }
      }

      // Check if hovering over a group header (for drag-to-group)
      dragOverGroupRef.current = null;
      const groupHeaders = groupHeaderPositionsRef.current;
      groupHeaders.forEach((gh, gid) => {
        const adjustedTop = gh.top - scrollDelta;
        const adjustedBottom = gh.bottom - scrollDelta;
        if (e.clientY >= adjustedTop && e.clientY <= adjustedBottom) {
          dragOverGroupRef.current = gid;
        }
      });
      setDragOverGroupId(dragOverGroupRef.current);

      // Compute target displayOrder index, taking group boundaries into account.
      // Also adjust for cursor position relative to card midpoint (above → before, below → after).
      let targetDisplayIdx: number;

      // Helper: get displayOrder index adjusted for above/below cursor position
      const getInsertIdx = (cardKey: string): number => {
        const baseIdx = displayOrder.indexOf(cardKey);
        if (baseIdx === -1) return 0;
        const pos = positions.get(cardKey);
        if (pos) {
          const adjustedMidY = pos.midY - scrollDelta;
          if (e.clientY > adjustedMidY) return baseIdx + 1; // insert after
        }
        return baseIdx; // insert before
      };

      // Determine slotBeforeGroupId for group-level slot placement.
      // This is set when the mouse is above a group header (boundary case)
      // and cleared when hovering directly over a group header (drag-to-group).
      let slotBeforeGroupId: string | undefined;

      // Check if hovering directly over a group header — this means drag-to-group,
      // not slot positioning. Suppress the blue slot entirely.
      const hoveringOverGroup = dragOverGroupRef.current;

      if (!hoveringOverGroup && !draggedGroupId) {
        // Check if mouse is above a group header → slot before that group
        const go = groupOrderRef.current;
        const gHeaders = groupHeaderPositionsRef.current;

        for (let i = 0; i < go.length; i++) {
          const gh = gHeaders.get(go[i]);
          if (!gh) continue;
          const adjustedTop = gh.top - scrollDelta;
          if (e.clientY < adjustedTop) {
            // Mouse is above this group's header → place slot before the group header
            slotBeforeGroupId = go[i];
            break;
          }
        }
      }

      if (!draggedGroupId && closestKey) {
        if (slotBeforeGroupId) {
          // Slot goes before a group header — use sourceIdx for currentIdx
          // so the card-level slot is suppressed; slotBeforeGroupId takes over.
          targetDisplayIdx = ds.sourceIdx;
        } else {
          targetDisplayIdx = getInsertIdx(closestKey);
        }
      } else if (draggedGroupId && closestKey) {
        targetDisplayIdx = getInsertIdx(closestKey);
      } else if (!closestKey) {
        if (draggedGroupId) {
          targetDisplayIdx = ds.currentIdx;
        } else {
          targetDisplayIdx = 0;
        }
      } else {
        targetDisplayIdx = getInsertIdx(closestKey);
      }

      // For ungrouped cards, snap targetDisplayIdx outside group boundaries.
      // Don't allow insertion between a group's cards — only before or after the entire group.
      // Skip this entirely when hovering over a group header (drag-to-group).
      if (!draggedGroupId && !hoveringOverGroup) {
        for (const gid of groupOrderRef.current) {
          const group = groups.find((g) => g.id === gid);
          if (!group || group.modKeys.length === 0) continue;
          let minIdx = Infinity;
          let maxIdx = -1;
          for (const mk of group.modKeys) {
            const idx = displayOrder.indexOf(mk);
            if (idx !== -1) {
              if (idx < minIdx) minIdx = idx;
              if (idx > maxIdx) maxIdx = idx;
            }
          }
          // targetDisplayIdx inside (or at the start of) a group → snap outside
          if (targetDisplayIdx >= minIdx && targetDisplayIdx <= maxIdx) {
            targetDisplayIdx = minIdx;
            slotBeforeGroupId = gid;
            break;
          }
        }
      }

      if (targetDisplayIdx === -1) {
        log.debug(`[drag] mousemove: targetDisplayIdx -1, closestKey=${closestKey}`);
        return;
      }

      if (!ds.started || targetDisplayIdx !== ds.currentIdx || slotBeforeGroupId !== ds.slotBeforeGroupId) {
        log.debug(`[drag] mousemove closestKey=${closestKey} targetDisplayIdx=${targetDisplayIdx} overGroup=${dragOverGroupRef.current} draggedGroupId=${draggedGroupId} slotBeforeGroupId=${slotBeforeGroupId}`);
      }

      setDragState((prev) =>
        prev
          ? {
              ...prev,
              started: true,
              currentIdx: targetDisplayIdx !== prev.currentIdx ? targetDisplayIdx : prev.currentIdx,
              slotBeforeGroupId,
            }
          : null,
      );
    };

    const handleMouseUp = () => {
      const ds = dragStateRef.current;
      const targetGroupId = dragOverGroupRef.current;
      log.debug(`[drag] mouseup sourceKey=${ds?.sourceKey} started=${ds?.started} sourceIdx=${ds?.sourceIdx} currentIdx=${ds?.currentIdx} dragOverGroup=${targetGroupId} slotBeforeGroupId=${ds?.slotBeforeGroupId}`);
      setDragState(null);
      if (ds?.started) {
        setTimeout(() => {
          preventClickRef.current = false;
        }, 0);
        // Compute the effective displayOrder target index.
        // - If slotBeforeGroupId is set: insert before that group's first card.
        // - Otherwise use currentIdx from card-level tracking.
        const effectiveTargetIdx = ds.slotBeforeGroupId
          ? (() => {
              const group = groups.find((g) => g.id === ds.slotBeforeGroupId);
              if (!group) return null;
              let minIdx = displayOrder.length;
              for (const mk of group.modKeys) {
                const idx = displayOrder.indexOf(mk);
                if (idx !== -1 && idx < minIdx) minIdx = idx;
              }
              return minIdx < displayOrder.length ? minIdx : null;
            })()
          : (ds.sourceIdx !== ds.currentIdx ? ds.currentIdx : null);

        // Only reorder displayOrder when NOT dropping onto a group header.
        // Dropping on a group = "add to group", not a positional reorder.
        if (!targetGroupId && effectiveTargetIdx !== null) {
          setDisplayOrder((prev) => {
            const next = [...prev];
            const [item] = next.splice(ds.sourceIdx, 1);
            const adjustedIdx = effectiveTargetIdx > ds.sourceIdx ? effectiveTargetIdx - 1 : effectiveTargetIdx;
            next.splice(adjustedIdx, 0, item);
            return next;
          });
        }
        // Handle drag-to-group: if dropped on a group header, move mod into that group
        if (targetGroupId) {
          handleMoveToGroup(ds.sourceKey, targetGroupId);
        } else {
          // Dropped on ungrouped area — remove from current group
          handleMoveToGroup(ds.sourceKey, null);
        }
        dragOverGroupRef.current = null;
        setDragOverGroupId(null);
      } else {
        // No movement — allow the click to proceed
        preventClickRef.current = false;
        setDragOverGroupId(null);
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState, displayOrder]);

  // Group header drag (same pattern as card drag)
  useEffect(() => {
    if (!groupHeaderDragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ds = groupHeaderDragStateRef.current;
      if (!ds) return;

      const dy = Math.abs(e.clientY - ds.startY);
      if (!ds.started && dy < DRAG_THRESHOLD) return;

      const container = scrollContainerRef.current;
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

      const scrollDelta = container ? container.scrollTop - scrollSnapshotRef.current : 0;
      const groupHeaders = groupHeaderPositionsRef.current;
      const cardPositions = cardPositionsRef.current;
      const go = groupOrderRef.current;

      // Collect keys of mods in the dragged group so we exclude them
      const ownGroup = groups.find((g) => g.id === ds.sourceGroupId);
      const ownModKeys = new Set(ownGroup?.modKeys ?? []);

      // Find closest group header (excluding self)
      let closestGid: string | null = null;
      let closestGidDist = Infinity;
      groupHeaders.forEach((gh, gid) => {
        if (gid === ds.sourceGroupId) return;
        const midY = (gh.top + gh.bottom) / 2 - scrollDelta;
        const dist = Math.abs(e.clientY - midY);
        if (dist < closestGidDist) {
          closestGidDist = dist;
          closestGid = gid;
        }
      });

      // Find closest card (excluding own group's cards)
      let closestCardKey: string | null = null;
      let closestCardDist = Infinity;
      let closestCardAbove: boolean = false;
      cardPositions.forEach((pos, k) => {
        if (ownModKeys.has(k)) return;
        const midY = pos.midY - scrollDelta;
        const dist = Math.abs(e.clientY - midY);
        if (dist < closestCardDist) {
          closestCardDist = dist;
          closestCardKey = k;
          closestCardAbove = e.clientY < midY;
        }
      });

      // Mark drag as started even with no target yet (opacity feedback).
      if (!ds.started) {
        setGroupHeaderDragState((prev) => prev ? { ...prev, started: true } : null);
      }

      // Pick the closer target: group header or card
      const useGroupTarget = closestGid && closestGidDist <= closestCardDist;
      const useCardTarget = closestCardKey && (!closestGid || closestCardDist < closestGidDist);

      if (useGroupTarget) {
        let targetIdx = go.indexOf(closestGid!);
        if (targetIdx === -1) return;

        const closestGh = groupHeaders.get(closestGid!);
        if (closestGh) {
          const midY = (closestGh.top + closestGh.bottom) / 2 - scrollDelta;
          if (e.clientY > midY) targetIdx += 1;
        }

        if (targetIdx !== ds.currentIdx || ds.slotBeforeKey) {
          log.debug(`[group-drag] mousemove closestGid=${closestGid} targetIdx=${targetIdx}`);
        }

        setGroupHeaderDragState((prev) =>
          prev ? { ...prev, currentIdx: targetIdx !== prev.currentIdx ? targetIdx : prev.currentIdx, slotBeforeKey: undefined } : null,
        );
      } else if (useCardTarget) {
        // Card-level target: store slotBeforeKey for rendering, keep currentIdx unchanged
        const changed = ds.slotBeforeKey !== closestCardKey || ds.insertAfter !== !closestCardAbove;
        if (changed) {
          log.debug(`[group-drag] mousemove cardTarget=${closestCardKey} above=${closestCardAbove}`);
        }
        setGroupHeaderDragState((prev) =>
          prev ? { ...prev, slotBeforeKey: changed ? closestCardKey! : prev.slotBeforeKey, insertAfter: changed ? !closestCardAbove : prev.insertAfter } : null,
        );
      }
      // else: no valid target — keep current state (opacity only)
    };

    const handleMouseUp = () => {
      const ds = groupHeaderDragStateRef.current;
      log.debug(`[group-drag] mouseup sourceGroupId=${ds?.sourceGroupId} started=${ds?.started} sourceIdx=${ds?.sourceIdx} currentIdx=${ds?.currentIdx} slotBeforeKey=${ds?.slotBeforeKey}`);
      setGroupHeaderDragState(null);
      if (ds?.started) {
        setTimeout(() => {
          preventClickRef.current = false;
        }, 0);

        if (ds.slotBeforeKey) {
          // Card-level target: move entire group's cards in displayOrder,
          // or set anchor for empty groups.
          const group = groups.find((g) => g.id === ds.sourceGroupId);
          if (group && group.modKeys.length > 0) {
            setDisplayOrder((prev) => {
              const next = [...prev];
              const groupModSet = new Set(group.modKeys);
              const moved: string[] = [];
              const filtered = next.filter((k) => {
                if (groupModSet.has(k)) { moved.push(k); return false; }
                return true;
              });
              let idx = filtered.indexOf(ds.slotBeforeKey!);
              if (idx === -1) idx = filtered.length;
              if (ds.insertAfter) idx += 1;
              filtered.splice(idx, 0, ...moved);
              log.debug(`[group-drag] mouseup moved group cards to displayOrder idx=${idx} insertAfter=${ds.insertAfter} moved=${moved.length} cards`);
              return filtered;
            });
          } else if (group && group.modKeys.length === 0) {
            // Empty group: use anchor positioning so the group renders between cards
            setGroups((prev) =>
              prev.map((g) =>
                g.id === ds.sourceGroupId
                  ? {
                      ...g,
                      anchorBefore: ds.insertAfter ? undefined : ds.slotBeforeKey,
                      anchorAfter: ds.insertAfter ? ds.slotBeforeKey : undefined,
                    }
                  : g,
              ),
            );
            log.debug(`[group-drag] mouseup set anchor for empty group, anchorBefore=${ds.insertAfter ? undefined : ds.slotBeforeKey} anchorAfter=${ds.insertAfter ? ds.slotBeforeKey : undefined}`);
          }
        } else if (ds.sourceIdx !== ds.currentIdx) {
          // Group-level target: reorder groupOrder
          setGroupOrder((prev) => {
            const next = [...prev];
            const [item] = next.splice(ds.sourceIdx, 1);
            next.splice(ds.currentIdx, 0, item);
            return next;
          });
        }
      } else {
        preventClickRef.current = false;
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [groupHeaderDragState, groupOrder]);

  // Group creation drag (separate from card drag)
  useEffect(() => {
    const GROUP_DRAG_THRESHOLD = 5;

    const handleMouseMove = (e: MouseEvent) => {
      const gc = groupCreateRef.current;
      if (!gc) return;

      const dy = Math.abs(e.clientY - gc.startY);
      if (!gc.active && dy < GROUP_DRAG_THRESHOLD) return;

      const container = scrollContainerRef.current;
      const scrollDelta = container ? container.scrollTop - scrollSnapshotRef.current : 0;

      // Use snapshotted positions (mousedown), not live DOM.
      // Live DOM shifts when placeholder appears → flicker + position errors.
      const positions = cardPositionsRef.current;
      const gHeaders = groupHeaderPositionsRef.current;

      // Find which UNGROUPED card is closest for placeholder positioning
      const currentGroupMap = modGroupMapRef.current;
      let closestKey: string | null = null;
      let closestDist = Infinity;
      positions.forEach((pos, k) => {
        if (currentGroupMap.has(k)) return;
        const adjustedMidY = pos.midY - scrollDelta;
        const dist = Math.abs(e.clientY - adjustedMidY);
        if (dist < closestDist) {
          closestDist = dist;
          closestKey = k;
        }
      });

      let insertAfter: string | null = null;
      let slotY = e.clientY;
      if (closestKey) {
        const pos = positions.get(closestKey)!;
        const adjustedMidY = pos.midY - scrollDelta;
        const adjustedTop = pos.top - scrollDelta;
        const adjustedBottom = pos.top + pos.height - scrollDelta;
        const above = e.clientY < adjustedMidY;
        insertAfter = above ? null : closestKey;
        slotY = above ? adjustedTop : adjustedBottom;
      }

      // Determine groupOrder insertion index by checking snapshotted group header positions
      let goIdx = groupOrderRef.current.length;
      for (let i = 0; i < groupOrderRef.current.length; i++) {
        const gid = groupOrderRef.current[i];
        const gh = gHeaders.get(gid);
        if (gh && e.clientY < gh.bottom - scrollDelta) {
          goIdx = i;
          break;
        }
      }

      const insertBefore = closestKey && !insertAfter ? closestKey : null;

      // Only update state when position actually changes (prevents flicker from re-renders)
      const changed = !gc.active || gc.insertAfter !== insertAfter || gc.insertBefore !== insertBefore || gc.groupOrderIdx !== goIdx;
      if (changed) {
        log.debug(`[group-create] mousemove closestKey=${closestKey} insertAfter=${insertAfter} insertBefore=${insertBefore} groupOrderIdx=${goIdx} groupOrder.length=${groupOrderRef.current.length} positions.size=${positions.size} gHeaders.size=${gHeaders.size} scrollDelta=${scrollDelta}`);
        setGroupCreateState({ active: true, startY: gc.startY, slotY, insertAfter, insertBefore, groupOrderIdx: goIdx });
      }
    };

    const handleMouseUp = () => {
      const gc = groupCreateRef.current;
      if (!gc) return;
      log.debug(`[group-create] mouseup active=${gc.active} insertAfter=${gc.insertAfter} insertBefore=${gc.insertBefore} groupOrderIdx=${gc.groupOrderIdx}`);

      // Create new group with card-level anchor so the empty group
      // renders between cards, not just at top/bottom relative to other groups.
      // Anchor is persisted on the ModGroup object itself (not a one-shot ref).
      const newGroup: ModGroup = {
        id: crypto.randomUUID(),
        name: "新建分组",
        collapsed: false,
        modKeys: [],
        anchorBefore: gc.insertBefore ?? undefined,
        anchorAfter: gc.insertAfter ?? undefined,
      };

      setGroupCreateState(null);

      setGroups((prev) => [...prev, newGroup]);

      if (gc.active) {
        // Drag-placed: insert at the computed groupOrder position
        setGroupOrder((prev) => {
          const idx = gc.groupOrderIdx;
          const next = [...prev];
          next.splice(idx, 0, newGroup.id);
          return next;
        });
      } else {
        // Click without drag or no target: create at top
        setGroupOrder((prev) => [newGroup.id, ...prev]);
      }

      // Auto-enter name editing
      setTimeout(() => setEditingGroupId(newGroup.id), 0);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

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
    <>
      {/* Filter bar — fixed at top */}
      <div className="shrink-0 px-6 py-2.5 border-b border-slate-700 bg-slate-800/50">
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

          {/* Apply display order to mod load order */}
          <button
            onClick={handleApplyOrder}
            title="将当前列表中已启用Mod的顺序同步为加载顺序（从0递增）"
            className="text-xs px-2 py-1.5 border border-amber-600 rounded
                       text-amber-300 bg-amber-950/30 hover:bg-amber-900/40
                       cursor-pointer transition-colors shrink-0"
          >
            应用顺序
          </button>

          {/* View mode toggle */}
          <button
            onClick={() => setViewMode((v) => (v === "detailed" ? "compact" : "detailed"))}
            title={viewMode === "detailed" ? "切换到紧凑视图" : "切换到详细视图"}
            className="text-xs px-2 py-1.5 border border-slate-600 rounded
                       text-slate-300 bg-slate-800 hover:border-slate-400
                       cursor-pointer transition-colors shrink-0"
          >
            {viewMode === "detailed" ? "紧凑" : "详细"}
          </button>

          {/* New group — drag from button to position */}
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              // Snapshot card positions and scroll state for correct placeholder tracking
              if (listRef.current) {
                // The scrollable cards container is the immediate parent of listRef
                const el: HTMLElement | null = listRef.current.parentElement;
                scrollContainerRef.current = el;
                scrollSnapshotRef.current = el ? el.scrollTop : 0;

                const positions = cardPositionsRef.current;
                positions.clear();
                const children = listRef.current.querySelectorAll("[data-mod-key]");
                children.forEach((child) => {
                  const k = child.getAttribute("data-mod-key")!;
                  const rect = child.getBoundingClientRect();
                  positions.set(k, { top: rect.top, midY: rect.top + rect.height / 2, height: rect.height });
                });

                // Snapshot group header positions too (use during drag, not live DOM)
                const gHeaders = groupHeaderPositionsRef.current;
                gHeaders.clear();
                const headers = listRef.current.querySelectorAll("[data-folder-id]");
                headers.forEach((header) => {
                  const gid = header.getAttribute("data-folder-id")!;
                  const rect = header.getBoundingClientRect();
                  gHeaders.set(gid, { top: rect.top, bottom: rect.bottom });
                });
              }
              setGroupCreateState({ active: false, startY: e.clientY, slotY: e.clientY, insertAfter: null, insertBefore: null, groupOrderIdx: groupOrderRef.current.length });
            }}
            className="text-xs px-2 py-1.5 border border-blue-700 rounded
                       text-blue-300 bg-blue-950/30 hover:bg-blue-900/40
                       cursor-pointer transition-colors shrink-0 select-none"
            title="按住拖拽到列表中创建分组"
          >
            + 分组
          </button>
        </div>
      </div>

      {/* Scrollable cards area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div ref={listRef}>
      {/* Mod cards */}
      {filtered.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-8">
          没有匹配的 Mod
        </p>
      ) : (
        (() => {
          const ds = dragState;
          const active = ds?.started;

          // Build render items: interleave ungrouped cards and groups based on displayOrder.
          // This allows ungrouped cards to appear above/between/below groups.
          type RenderItem =
            | { type: "group-header"; group: ModGroup }
            | { type: "mod"; mod: ModInfo; key: string; indented: boolean }
            | { type: "group-creation-placeholder"; group: null };

          const renderedModKeys = new Set<string>();
          const renderedGroupIds = new Set<string>();
          const renderItems: RenderItem[] = [];

          // Walk displayOrder to produce interleaved visual ordering
          for (const key of displayOrder) {
            if (renderedModKeys.has(key)) continue;

            const gid = modGroupMap.get(key);

            if (gid && !renderedGroupIds.has(gid)) {
              // First encounter of a new group — emit header + all its cards
              const group = groups.find((g) => g.id === gid);
              if (group && groupOrder.includes(group.id)) {
                renderedGroupIds.add(gid);
                renderItems.push({ type: "group-header", group });
                if (!group.collapsed) {
                  // Sort group's mods by displayOrder
                  const groupMods = group.modKeys
                    .map((k) => ({ key: k, mod: filtered.find((m) => `${m.source}_${m.fileId}` === k) }))
                    .filter((x): x is { key: string; mod: ModInfo } => x.mod != null)
                    .sort((a, b) => {
                      const ia = displayOrder.indexOf(a.key);
                      const ib = displayOrder.indexOf(b.key);
                      return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
                    });
                  for (const { key: mk, mod } of groupMods) {
                    if (!renderedModKeys.has(mk)) {
                      renderItems.push({ type: "mod", mod, key: mk, indented: true });
                      renderedModKeys.add(mk);
                    }
                  }
                } else {
                  // Collapsed: mark as rendered so cards don't leak outside
                  for (const mk of group.modKeys) renderedModKeys.add(mk);
                }
              }
              continue;
            }

            // Ungrouped card (or already-rendered group member skipped above)
            if (!renderedModKeys.has(key)) {
              const mod = filtered.find((m) => `${m.source}_${m.fileId}` === key);
              if (mod) {
                renderItems.push({ type: "mod", mod, key, indented: false });
                renderedModKeys.add(key);
              }
            }
          }

          // Handle any remaining mods not in displayOrder (newly added, etc.)
          for (const mod of filtered) {
            const key = `${mod.source}_${mod.fileId}`;
            if (renderedModKeys.has(key)) continue;
            const gid = modGroupMap.get(key);
            if (gid && !renderedGroupIds.has(gid)) {
              const group = groups.find((g) => g.id === gid);
              if (group && groupOrder.includes(group.id)) {
                renderedGroupIds.add(gid);
                renderItems.push({ type: "group-header", group });
                if (!group.collapsed) {
                  for (const mk of group.modKeys) {
                    if (!renderedModKeys.has(mk)) {
                      const m = filtered.find((x) => `${x.source}_${x.fileId}` === mk);
                      if (m) {
                        renderItems.push({ type: "mod", mod: m, key: mk, indented: true });
                        renderedModKeys.add(mk);
                      }
                    }
                  }
                }
              }
            }
            if (!renderedModKeys.has(key)) {
              renderItems.push({ type: "mod", mod, key, indented: false });
              renderedModKeys.add(key);
            }
          }

          // Interpolate any unrendered groups (empty groups, etc.)
          for (let gi = 0; gi < groupOrder.length; gi++) {
            const gid = groupOrder[gi];
            if (renderedGroupIds.has(gid)) continue;
            const group = groups.find((g) => g.id === gid);
            if (!group) continue;

            let insertAt: number;

            // For a newly created empty group, use the card-level anchor
            // persisted on the ModGroup object so the group appears between
            // the cards the user targeted, not just top/bottom.
            if (group.anchorBefore) {
              const idx = renderItems.findIndex(
                (item) => item.type === "mod" && item.key === group.anchorBefore,
              );
              insertAt = idx === -1 ? 0 : idx;
              log.debug(`[group-create] anchor anchorBefore=${group.anchorBefore} idx=${idx} insertAt=${insertAt}`);
            } else if (group.anchorAfter) {
              const idx = renderItems.findIndex(
                (item) => item.type === "mod" && item.key === group.anchorAfter,
              );
              insertAt = idx === -1 ? renderItems.length : idx + 1;
              log.debug(`[group-create] anchor anchorAfter=${group.anchorAfter} idx=${idx} insertAt=${insertAt} renderItems.length=${renderItems.length}`);
            } else if (groupOrder.length === 1) {
              insertAt = 0;
            } else {
              insertAt = renderItems.length;
              for (let gj = gi + 1; gj < groupOrder.length; gj++) {
                const nextIdx = renderItems.findIndex(
                  (item) => item.type === "group-header" && item.group.id === groupOrder[gj],
                );
                if (nextIdx !== -1) {
                  insertAt = nextIdx;
                  break;
                }
              }
            }

            renderItems.splice(insertAt, 0, { type: "group-header", group });
            renderedGroupIds.add(gid);
          }

          // Insert group creation placeholder if active
          if (groupCreateState?.active) {
            let placeholderIdx: number;
            if (groupCreateState.insertBefore) {
              const idx = renderItems.findIndex(
                (item) => item.type === "mod" && item.key === groupCreateState.insertBefore,
              );
              placeholderIdx = idx === -1 ? 0 : idx;
            } else if (groupCreateState.insertAfter) {
              const idx = renderItems.findIndex(
                (item) => item.type === "mod" && item.key === groupCreateState.insertAfter,
              );
              placeholderIdx = idx === -1 ? renderItems.length : idx + 1;
            } else {
              placeholderIdx = 0;
            }
            log.debug(`[group-create] render placeholderIdx=${placeholderIdx} insertAfter=${groupCreateState.insertAfter} insertBefore=${groupCreateState.insertBefore} groupOrderIdx=${groupCreateState.groupOrderIdx}`);
            renderItems.splice(placeholderIdx, 0, {
              type: "group-creation-placeholder",
              group: null,
            });
          }

          // Group header drag placeholder
          const ghds = groupHeaderDragState;
          const ghActive = ghds?.started && ghds.sourceIdx !== ghds.currentIdx;
          let groupHeaderSlotIdx = -1;
          if (ghActive) {
            const targetGid = groupOrder[ghds!.currentIdx];
            if (targetGid) {
              groupHeaderSlotIdx = renderItems.findIndex(
                (item) => item.type === "group-header" && item.group.id === targetGid,
              );
            }
          }

          // Group header drag — card-level target slot
          let groupDragCardSlotIdx = -1;
          if (ghds?.slotBeforeKey) {
            groupDragCardSlotIdx = renderItems.findIndex(
              (item) => item.type === "mod" && item.key === ghds.slotBeforeKey,
            );
          }

          // Map drag state to render-index for card-slot placement.
          // - If slotBeforeGroupId is set, place the slot before that group header.
          // - Otherwise use currentIdx (displayOrder) to find the target card.
          // - When hovering over a group header (dragOverGroupId), suppress the slot.
          let slotRenderIdx = -1;
          if (active && !dragOverGroupId) {
            if (ds!.slotBeforeGroupId) {
              slotRenderIdx = renderItems.findIndex(
                (item) => item.type === "group-header" && item.group.id === ds!.slotBeforeGroupId,
              );
            } else if (ds!.sourceIdx !== ds!.currentIdx) {
              const targetKey = displayOrder[ds!.currentIdx];
              if (targetKey) {
                slotRenderIdx = renderItems.findIndex(
                  (item) => item.type === "mod" && item.key === targetKey,
                );
              }
            }
          }

          return renderItems.map((item, index) => {
            if (item.type === "group-creation-placeholder") {
              return (
                <div
                  key="group-create-placeholder"
                  className="rounded-lg border-2 border-dashed border-yellow-500/60 bg-yellow-500/5"
                  style={{ height: 40 }}
                />
              );
            }
            if (item.type === "group-header") {
              const group = item.group;
              const isEditing = editingGroupId === group.id;
              const groupDragging = ghds?.started && ghds.sourceGroupId === group.id;
              return (
                <Fragment key={group.id}>
                  {index === groupHeaderSlotIdx && (
                    <div
                      key="group-header-slot"
                      className="rounded-lg border-2 border-blue-500 border-dashed bg-blue-950/20 animate-pulse"
                      style={{ height: groupHeaderHeightRef.current }}
                    />
                  )}
                  {index === slotRenderIdx && (
                    <div
                      key="card-slot-before-group"
                      className="rounded-lg border-2 border-blue-500 border-dashed bg-blue-950/20 animate-pulse"
                      style={{ height: dragCardHeightRef.current }}
                    />
                  )}
                  <div
                    data-folder-id={group.id}
                    onMouseDown={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest("button, input, label, select")) return;
                      handleGroupHeaderDragMouseDown(e, group.id);
                    }}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border select-none ${
                      dragOverGroupId === group.id
                        ? "border-green-500 bg-green-950/40"
                        : "border-blue-700/50 bg-blue-950/20"
                    } ${groupDragging ? "opacity-30" : ""}`}
                  >
                    <span
                      className="text-xs text-blue-300 cursor-pointer"
                      onClick={() => handleToggleGroup(group.id)}
                    >
                      {group.collapsed ? "▶" : "▼"}
                    </span>
                    {isEditing ? (
                      <input
                        autoFocus
                        defaultValue={group.name}
                        onBlur={() => setEditingGroupId(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const val = (e.target as HTMLInputElement).value.trim();
                            if (val) handleRenameGroup(group.id, val);
                            setEditingGroupId(null);
                          } else if (e.key === "Escape") {
                            setEditingGroupId(null);
                          }
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-blue-300 bg-blue-950/50
                                   border border-blue-600 rounded px-1 outline-none
                                   min-w-[6em] w-auto"
                      />
                    ) : (
                      <span
                        className="text-sm font-medium text-blue-300 cursor-pointer
                                   min-w-[2em]"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingGroupId(group.id);
                        }}
                      >
                        {group.name}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">
                      ({group.modKeys.length})
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(group.id);
                      }}
                      title="删除分组"
                      className="text-xs text-slate-500 hover:text-red-400 cursor-pointer transition-colors ml-auto"
                    >
                      删除
                    </button>
                  </div>
                </Fragment>
              );
            }

            // Mod card item
            const mod = item.mod;
            const dragging = active && ds!.sourceKey === item.key;

            return (
              <div key={item.key}>
                {index === slotRenderIdx && (
                  <div
                    className="rounded-lg border-2 border-blue-500 border-dashed bg-blue-950/20 animate-pulse"
                    style={{ height: dragCardHeightRef.current }}
                  />
                )}
                {index === groupDragCardSlotIdx && (
                  <div
                    className="rounded-lg border-2 border-blue-500 border-dashed bg-blue-950/20 animate-pulse"
                    style={{ height: groupDragSlotHeightRef.current }}
                  />
                )}
                <div
                  data-mod-key={item.key}
                  className={`${item.indented ? "ml-6" : ""} ${
                    dragging ? "scale-[0.98] opacity-40 z-10 relative transition-all duration-200" : ""
                  }`}
                >
                  <ModCard
                    mod={mod}
                    disabled={saving}
                    onToggle={handleToggle}
                    onSelect={() => {
                      if (preventClickRef.current) return;
                      onSelectMod(item.key);
                    }}
                    onOrderUp={(e) => {
                      e.stopPropagation();
                      setModOrder(item.key, mod.order + 1);
                      saveModSettings();
                    }}
                    onOrderDown={(e) => {
                      e.stopPropagation();
                      setModOrder(item.key, Math.max(0, mod.order - 1));
                      saveModSettings();
                    }}
                    onOrderChange={(order) => handleOrderChange(item.key, order)}
                    onDragMouseDown={handleDragMouseDown}
                    isDragging={dragging}
                    isDragOver={false}
                    viewMode={viewMode}
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
      </div>
    </>
  );
}
