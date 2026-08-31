import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { useModStore } from "../../store/useModStore";
import { useAppStore } from "../../store/useAppStore";
import { useCategoryStore } from "../../store/useCategoryStore";
import { useConflictDetection } from "../../hooks/useConflictDetection";
import { getUserTags } from "../../utils/userTags";
import type { ModInfo, ModGroup } from "../../lib/types";
import ModCard from "./ModCard";
import ModFilterBar from "./ModFilterBar";
import ModGroupHeader from "./ModGroupHeader";
import ModContextMenu from "./ModContextMenu";
import GroupContextMenu from "./GroupContextMenu";
import MultiContextMenu from "./MultiContextMenu";
import CategoryPicker from "../common/CategoryPicker";
import NoteEditor from "../common/NoteEditor";
import ModActionMenu from "../common/ModActionMenu";
import { ask } from "@tauri-apps/plugin-dialog";
import { openInExplorer, openSteamWorkshop } from "../../lib/tauriApi";
import { useModListState, type CategoryKey } from "./useModListState";
import { useCardDrag } from "./useCardDrag";
import { useGroupHeaderDrag } from "./useGroupHeaderDrag";
import { useGroupCreateDrag } from "./useGroupCreateDrag";
import {
  buildRenderItems,
  computeCardInsertLineIdx,
  computeGroupInsertLineIdx,
  computeGroupDragCardInsertLineIdx,
  createDragRefs,
  type DragRefs,
  type RenderItem,
} from "./utils";

interface Props {
  saving: boolean;
  onSelectMod: (key: string) => void;
  /** ★ v2: save current multi-selection as an offline collection */
  onSaveSelectionAsCollection?: () => void;
  /** ★ v3: read-only browse mode (ModsPage) — toggle/order/apply-order disabled */
  readOnly?: boolean;
  /** ★ v3: when provided, mod context menu uses ModActionMenu (加入/新建 two-level) */
  modMenu?: {
    schemes: { name: string; modCount?: number }[];
    collections: { id: string; name: string }[];
    onAddToScheme: (schemeName: string, modKeys: string[]) => void;
    onAddToCollection: (collectionId: string, modKeys: string[]) => void;
    onCreateScheme: () => void;
    onCreateCollection: () => void;
  };
  /**
   * ★ v3: controlled data source — binds the list to container data
   * (scheme/collection) instead of the global stores. When provided, the
   * dual-view (active-scheme pool) is skipped and all mutations flow through
   * the controller callbacks.
   */
  controlled?: {
    mods: ModInfo[];
    groups: ModGroup[];
    displayOrder: string[];
    setGroups: (groups: ModGroup[]) => void;
    setDisplayOrder: (order: string[]) => void;
    toggleMod: (fileId: number, enabled: boolean) => void;
    setModOrder: (key: string, order: number) => void;
    clearSelection: () => void;
    selectedModKeys: string[];
    selectModOnly: (key: string) => void;
    toggleSelectMod: (key: string) => void;
    addModsToSelection: (keys: string[]) => void;
    /** ★ shift-range anchor (defaults to null in controlled mode). */
    lastClickedKey?: string | null;
    setLastClickedKey?: (key: string | null) => void;
  };
}

export default function ModList({ saving, onSelectMod, onSaveSelectionAsCollection, modMenu, readOnly, controlled }: Props) {
  // ── Data source: global stores (always called unconditionally) or controlled
  //    container (scheme/collection). Hooks must be unconditional — values are
  //    overridden below when controlled.
  const storeMods = useModStore((s) => s.mods);
  const storeScanning = useModStore((s) => s.scanning);
  const storeError = useModStore((s) => s.error);
  const storeToggleMod = useModStore((s) => s.toggleMod);
  const storeSetModOrder = useModStore((s) => s.setModOrder);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const setDirty = useAppStore((s) => s.setDirty);
  const storeGroups = useAppStore((s) => s.groups);
  const storeSetGroups = useAppStore((s) => s.setGroups);
  const storeActiveSchemeName = useAppStore((s) => s.activeSchemeName);
  const storeActiveSchemeModKeys = useAppStore((s) => s.activeSchemeModKeys);
  const storeSetActiveSchemeModKeys = useAppStore((s) => s.setActiveSchemeModKeys);
  const storeSelectedModKeys = useModStore((s) => s.selectedModKeys);
  const storeLastClickedKey = useModStore((s) => s.lastClickedKey);
  const storeSelectModOnly = useModStore((s) => s.selectModOnly);
  const storeToggleSelectMod = useModStore((s) => s.toggleSelectMod);
  const storeAddModsToSelection = useModStore((s) => s.addModsToSelection);
  const storeClearSelection = useModStore((s) => s.clearSelection);

  // Controlled overrides (scheme/collection container data)
  const mods = controlled?.mods ?? storeMods;
  const scanning = controlled ? false : storeScanning;
  const error = controlled ? null : storeError;
  const toggleMod = controlled?.toggleMod ?? storeToggleMod;
  const setModOrder = controlled?.setModOrder ?? storeSetModOrder;
  const groups = controlled?.groups ?? storeGroups;
  // Normalize setGroups to accept either a value or an updater function.
  // Stable via ref so drag-hook closures always see the latest controlled value.
  const controlledRef = useRef(controlled);
  useEffect(() => { controlledRef.current = controlled; }, [controlled]);
  const setGroups = useCallback(
    (updater: ModGroup[] | ((prev: ModGroup[]) => ModGroup[])) => {
      const c = controlledRef.current;
      if (c) {
        const next =
          typeof updater === "function" ? updater(c.groups) : updater;
        c.setGroups(next);
      } else {
        storeSetGroups(updater);
      }
    },
    [storeSetGroups],
  );
  // ★ v2: active scheme member whitelist for dual-view (members + pool).
  // Controlled mode (scheme/collection) has no pool concept — disabled.
  const activeSchemeName = controlled ? null : storeActiveSchemeName;
  const activeSchemeModKeys = controlled ? null : storeActiveSchemeModKeys;
  const setActiveSchemeModKeys = controlled ? undefined : storeSetActiveSchemeModKeys;
  // ★ v2: conflict detection within the active scheme member scope (if any).
  // Controlled mode: detect across the whole controlled member list.
  const activeSchemeModKeysForConflict = controlled
    ? controlled.mods.map((m) => `${m.source}_${m.fileId}`)
    : storeActiveSchemeModKeys;
  const conflictScope = useMemo(() => {
    if (!activeSchemeModKeysForConflict || activeSchemeModKeysForConflict.length === 0) {
      return null;
    }
    return { modKeys: activeSchemeModKeysForConflict, onlyEnabled: true };
  }, [activeSchemeModKeysForConflict]);
  const { conflictMap } = useConflictDetection(
    mods,
    conflictScope ?? { modKeys: [], onlyEnabled: true },
  );
  const modTitles = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of mods) map[`${m.source}_${m.fileId}`] = m.title;
    return map;
  }, [mods]);

  // ── Multi-select: controlled or global store ──────────────────────────────
  const selectedModKeys = controlled?.selectedModKeys ?? storeSelectedModKeys;
  const lastClickedKey = controlled ? (controlled.lastClickedKey ?? null) : storeLastClickedKey;
  const selectModOnly = controlled?.selectModOnly ?? storeSelectModOnly;
  const toggleSelectMod = controlled?.toggleSelectMod ?? storeToggleSelectMod;
  const addModsToSelection = controlled?.addModsToSelection ?? storeAddModsToSelection;
  const clearSelection = controlled?.clearSelection ?? storeClearSelection;
  const selectionCount = selectedModKeys.length;

  // ── Filter / search state ────────────────────────────────────────────────
  const filter = useModListState(mods);

  // ★ v3: displayOrder — controlled (container) or global filter state.
  // Stable via controlledRef so drag-hook closures always see the latest value.
  const displayOrder = controlled?.displayOrder ?? filter.displayOrder;
  const setDisplayOrder: (updater: string[] | ((prev: string[]) => string[])) => void = useCallback(
    (updater) => {
      const c = controlledRef.current;
      if (c) {
        const next =
          typeof updater === "function" ? updater(c.displayOrder) : updater;
        c.setDisplayOrder(next);
      } else {
        filter.setDisplayOrder(updater);
      }
    },
    [filter],
  );

  // ── Group helpers ────────────────────────────────────────────────────────
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // ── Context menu state ───────────────────────────────────────────────────
  type ContextMenuState =
    | { type: "mod"; key: string; x: number; y: number }
    | { type: "group"; groupId: string; x: number; y: number }
    | { type: "multi"; x: number; y: number }
    | null;
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  // ★ v2: mod-level popup triggered from context menu (category/note)
  const [modPopup, setModPopup] = useState<{ modKey: string; kind: "category" | "note" } | null>(null);

  const handleDeleteGroup = useCallback(
    async (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      const count = group?.modKeys.length ?? 0;
      const confirmed = await ask(
        count > 0
          ? `确定要删除此分组吗？分组内的 ${count} 个 Mod 将回到未分组状态。`
          : "确定要删除此空分组吗？",
        { title: "删除分组", kind: "warning" },
      );
      if (!confirmed) return;
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setDisplayOrder((prev) => prev.filter((id) => id !== groupId));
    },
    [setGroups, setDisplayOrder, groups],
  );

  const handleToggleGroup = useCallback(
    (groupId: string) =>
      setGroups((prev) =>
        prev.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)),
      ),
    [setGroups],
  );

  const handleRenameGroup = useCallback(
    (groupId: string, name: string) =>
      setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, name } : g))),
    [setGroups],
  );

  const handleMoveToGroup = useCallback(
    (modKey: string, groupId: string | null) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id === groupId) {
            const deduped = [...new Set(g.modKeys)];
            if (deduped.includes(modKey)) {
              return g.collapsed
                ? { ...g, modKeys: deduped, collapsed: false }
                : { ...g, modKeys: deduped };
            }
            return {
              ...g,
              modKeys: [...deduped, modKey],
              collapsed: false,
            };
          }
          return { ...g, modKeys: g.modKeys.filter((k) => k !== modKey) };
        }),
      );
    },
    [setGroups],
  );

  // ── Context menu action handlers ──────────────────────────────────────────

  /** Shared helper: move keys to a target group.
   *  Keys stay in displayOrder — buildRenderItems skips them while
   *  their group is rendered, and uses displayOrder position for sort. */
  const moveKeysToGroup = useCallback(
    (keys: string[], targetGroupId: string) => {
      const targetGroup = groups.find((g) => g.id === targetGroupId);
      if (!targetGroup) return;
      for (const k of keys) {
        handleMoveToGroup(k, targetGroupId);
      }
    },
    [handleMoveToGroup, groups],
  );

  const handleSendToGroup = useCallback(
    (modKey: string, targetGroupId: string) => {
      moveKeysToGroup([modKey], targetGroupId);
    },
    [moveKeysToGroup],
  );

  const handleCreateGroupAndSend = useCallback(
    (modKey: string) => {
      const newGroup: ModGroup = {
        id: crypto.randomUUID(),
        name: "新建分组",
        collapsed: false,
        modKeys: [modKey],
      };
      // Remove from old group and add to new group
      setGroups((prev) => {
        const updated = prev.map((g) => ({
          ...g,
          modKeys: g.modKeys.filter((k) => k !== modKey),
        }));
        return [...updated, newGroup];
      });
      // Insert group ID into displayOrder right before the mod key.
      // The mod key stays — buildRenderItems skips it when the group renders.
      setDisplayOrder((prev) => {
        const modIdx = prev.indexOf(modKey);
        if (modIdx === -1) return [...prev, newGroup.id];
        const next = [...prev];
        next.splice(modIdx, 0, newGroup.id);
        return next;
      });
      // Trigger rename for the new group
      setTimeout(() => setEditingGroupId(newGroup.id), 0);
    },
    [setGroups, setDisplayOrder],
  );

  const handleUngroup = useCallback(
    async (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group || group.modKeys.length === 0) return;
      const confirmed = await ask(
        `确定要取消此分组吗？分组内的 ${group.modKeys.length} 个 Mod 将回到未分组状态。`,
        { title: "取消分组", kind: "warning" },
      );
      if (!confirmed) return;
      // Move all mods out of the group
      for (const mk of group.modKeys) {
        handleMoveToGroup(mk, null);
      }
      // Remove the empty group
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setDisplayOrder((prev) => prev.filter((id) => id !== groupId));
    },
    [groups, handleMoveToGroup, setGroups, setDisplayOrder],
  );

  // ── Batch mod operations (for multi-select context menu) ──────────────────
  const handleBatchToggleMods = useCallback(() => {
    const currentMods = mods;
    const selectedSet = new Set(selectedModKeys);
    const selected = currentMods.filter((m) => selectedSet.has(`${m.source}_${m.fileId}`));
    const allEnabled = selected.every((m) => m.enabled);
    const newEnabled = !allEnabled;
    for (const m of selected) {
      useModStore.getState().toggleMod(m.fileId, newEnabled);
    }
    setDirty(true);
  }, [selectedModKeys, setDirty]);

  const handleBatchSendToGroup = useCallback(
    (targetGroupId: string) => {
      moveKeysToGroup(selectedModKeys, targetGroupId);
      setDirty(true);
      clearSelection();
    },
    [selectedModKeys, moveKeysToGroup, setDirty, clearSelection],
  );

  const handleBatchOrderUp = useCallback(() => {
    setDisplayOrder((prev) => {
      const next = [...prev];
      const selectedSet = new Set(selectedModKeys);
      // Move each selected mod up, skipping other selected mods
      for (let i = 0; i < next.length; i++) {
        if (selectedSet.has(next[i])) {
          let j = i - 1;
          while (j >= 0 && selectedSet.has(next[j])) j--;
          if (j >= 0) {
            const [item] = next.splice(i, 1);
            next.splice(j, 0, item);
          }
        }
      }
      return next;
    });
    setDirty(true);
  }, [selectedModKeys, setDisplayOrder, setDirty]);

  const handleBatchOrderDown = useCallback(() => {
    setDisplayOrder((prev) => {
      const next = [...prev];
      const selectedSet = new Set(selectedModKeys);
      // Move each selected mod down, skipping other selected mods
      for (let i = next.length - 1; i >= 0; i--) {
        if (selectedSet.has(next[i])) {
          let j = i + 1;
          while (j < next.length && selectedSet.has(next[j])) j++;
          if (j < next.length) {
            const [item] = next.splice(i, 1);
            next.splice(j, 0, item);
          }
        }
      }
      return next;
    });
    setDirty(true);
  }, [selectedModKeys, setDisplayOrder, setDirty]);

  // modKey → group lookup
  const modGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((g) => g.modKeys.forEach((k) => map.set(k, g.id)));
    return map;
  }, [groups]);
  const modGroupMapRef = useRef(modGroupMap);
  useLayoutEffect(() => { modGroupMapRef.current = modGroupMap; });

  // Reactive group mod counts derived from modGroupMap — always correct
  // even if modKeys contains duplicates.
  const groupModCounts = useMemo(() => {
    const counts = new Map<string, number>();
    modGroupMap.forEach((gid) => {
      counts.set(gid, (counts.get(gid) ?? 0) + 1);
    });
    return counts;
  }, [modGroupMap]);

  const displayOrderRef = useRef(displayOrder);
  useLayoutEffect(() => { displayOrderRef.current = displayOrder; });

  // ── Reactive cross-group dedup: guarantee no modKey appears in multiple
  //    groups. This is a safety net — in normal operation it should never fire.
  //    When duplicates are detected, keep each key in the group with the
  //    lowest displayOrder index (i.e. the "first" group visually).
  useEffect(() => {
    const keyOwner = new Map<string, string>();
    const groupPriority = new Map(displayOrder.map((id, i) => [id, i]));
    const hasDupes = groups.some((g) =>
      g.modKeys.some((mk) => {
        const existing = keyOwner.get(mk);
        if (existing !== undefined) {
          const existPrio = groupPriority.get(existing) ?? Infinity;
          const myPrio = groupPriority.get(g.id) ?? Infinity;
          if (myPrio < existPrio) {
            keyOwner.set(mk, g.id);
          }
          return true;
        }
        keyOwner.set(mk, g.id);
        return false;
      }),
    );
    if (!hasDupes) return;

    // Recompute ownership: each modKey belongs to the earliest group in
    // displayOrder that contains it.
    keyOwner.clear();
    const sorted = groups
      .map((g) => g)
      .sort((a, b) => {
        const pa = groupPriority.get(a.id) ?? Infinity;
        const pb = groupPriority.get(b.id) ?? Infinity;
        return pa - pb;
      });
    for (const g of sorted) {
      for (const mk of g.modKeys) {
        if (!keyOwner.has(mk)) keyOwner.set(mk, g.id);
      }
    }

    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        modKeys: g.modKeys.filter((mk) => keyOwner.get(mk) === g.id),
      })),
    );
  }, [groups, displayOrder, setGroups]);

  // ── Persist prefs ────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(
        "twm-filter-prefs",
        JSON.stringify({
          activeCategories: [...filter.activeCategories],
          tagMode: filter.tagMode,
          viewMode: filter.viewMode,
          groups,
          displayOrder: displayOrder,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [filter.activeCategories, filter.tagMode, filter.viewMode, groups, displayOrder]);

  const handleOrderChange = useCallback(
    (key: string, order: number) => {
      // ★ v3: read-only browse mode — no ordering
      if (readOnly) return;
      // ★ v2: scheme-outside mods are read-only
      const memberSet = activeSchemeModKeys ? new Set(activeSchemeModKeys) : null;
      if (memberSet && !memberSet.has(key)) {
        setLastMessage("该 Mod 未加入当前方案，无法调整顺序");
        return;
      }
      clearSelection();
      setModOrder(key, order);
      setDirty(true);
    },
    [setModOrder, setDirty, clearSelection, activeSchemeModKeys, setLastMessage, readOnly],
  );

  const handleApplyOrder = useCallback(() => {
    const currentMods = mods;
    const keyModMap = new Map(currentMods.map((m) => [`${m.source}_${m.fileId}`, m]));
    const updates: [string, number][] = [];

    let nextOrder = 0;
    const emittedGroups = new Set<string>();

    // Walk displayOrder — group IDs and mod keys are interleaved.
    // Group IDs are UUIDs (no underscore); mod keys are "${source}_${fileId}".
    for (const key of displayOrder) {
      // Check if this key is a group ID
      const group = groups.find((g) => g.id === key);
      if (group) {
        if (emittedGroups.has(key)) continue;
        emittedGroups.add(key);
        // Emit all enabled members in displayOrder-index order
        const sorted = group.modKeys
          .filter((mk) => keyModMap.has(mk))
          .sort((a, b) => {
            const ai = displayOrder.indexOf(a);
            const bi = displayOrder.indexOf(b);
            // Items not in displayOrder go last
            return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
          });
        for (const mk of sorted) {
          const mod = keyModMap.get(mk)!;
          if (mod.enabled) updates.push([mk, nextOrder++]);
          keyModMap.delete(mk);
        }
        continue;
      }

      // Otherwise this is an ungrouped mod key
      if (!keyModMap.has(key)) continue;
      const mod = keyModMap.get(key)!;
      if (mod.enabled) updates.push([key, nextOrder++]);
      keyModMap.delete(key);
    }

    // Remaining enabled mods not in displayOrder
    for (const [key, mod] of keyModMap) {
      if (mod.enabled) updates.push([key, nextOrder++]);
    }

    for (const [key, order] of updates) setModOrder(key, order);
    setDirty(true);
    setLastMessage(`已应用加载顺序 — ${updates.length} 个已启用 Mod 从 0 递增`);
  }, [displayOrder, groups, modGroupMap, setModOrder, setDirty, setLastMessage]);

  // ── Drag refs (shared across all drag systems) ────────────────────────────
  const dragRefs: DragRefs = useMemo(() => createDragRefs(), []);
  const listRef = dragRefs.listRef;
  const preventClickRef = dragRefs.preventClickRef;

  // ── Drag hooks ───────────────────────────────────────────────────────────
  const {
    dragState,
    dragOverGroupId,
    lineIndented,
    handleDragMouseDown,
  } = useCardDrag({
    displayOrder,
    setDisplayOrder,
    groups,
    modGroupMapRef,
    handleMoveToGroup,
    refs: dragRefs,
    selectedModKeys: controlled?.selectedModKeys,
    clearSelection: controlled?.clearSelection,
  });

  const {
    groupHeaderDragState,
    handleGroupHeaderDragMouseDown,
  } = useGroupHeaderDrag({
    displayOrder,
    setDisplayOrder,
    groups,
    refs: dragRefs,
    clearSelection: controlled?.clearSelection,
  });

  const { groupCreateState, handleGroupCreateMouseDown } = useGroupCreateDrag({
    setGroups,
    setDisplayOrder,
    setEditingGroupId,
    modGroupMapRef,
    groups,
    refs: dragRefs,
    clearSelection: controlled?.clearSelection,
  });

  // ── Toggle handler ───────────────────────────────────────────────────────
  const handleToggle = useCallback(
    (fileId: number, enabled: boolean) => {
      // ★ v3: read-only browse mode — no toggling
      if (readOnly) return;
      // ★ v2: scheme-outside mods are read-only — cannot be toggled
      const key = `${mods.find((m) => m.fileId === fileId)?.source ?? 0}_${fileId}`;
      const memberSet = activeSchemeModKeys ? new Set(activeSchemeModKeys) : null;
      if (memberSet && !memberSet.has(key)) {
        setLastMessage("该 Mod 未加入当前方案，请在方案内添加后再启用");
        return;
      }
      clearSelection();
      toggleMod(fileId, enabled);
      setDirty(true);
    },
    [toggleMod, setDirty, clearSelection, activeSchemeModKeys, setLastMessage, readOnly],
  );

  // ── Selection click handlers ──────────────────────────────────────────────
  const saveEditAndExit = useCallback(() => {
    if (!editingGroupId) return;
    const input = document.querySelector(
      `[data-folder-id="${editingGroupId}"] input`,
    ) as HTMLInputElement | null;
    if (input) {
      const val = input.value.trim();
      if (val) {
        const gid = editingGroupId;
        setGroups((prev) => prev.map((g) => (g.id === gid ? { ...g, name: val } : g)));
      }
    }
    setEditingGroupId(null);
  }, [editingGroupId, setGroups, setEditingGroupId]);

  const handleModClick = useCallback(
    (key: string, e: React.MouseEvent) => {
      if (preventClickRef.current) return;
      saveEditAndExit();
      if (e.ctrlKey || e.metaKey) {
        // Context-locked: grouped and ungrouped mods never mix.
        // Toggling a mod from a different context clears the old selection.
        const curMap = modGroupMapRef.current;
        const clickedCtx = curMap.get(key) ?? null;
        if (selectedModKeys.length > 0) {
          const selCtx = curMap.get(selectedModKeys[0]) ?? null;
          if (clickedCtx !== selCtx) {
            selectModOnly(key);
          } else {
            toggleSelectMod(key);
          }
        } else {
          toggleSelectMod(key);
        }
      } else if (e.shiftKey && lastClickedKey) {
        const disp = displayOrder;
        const from = disp.indexOf(lastClickedKey);
        const to = disp.indexOf(key);
        if (from !== -1 && to !== -1) {
          // Range selection respects group boundaries:
          // - Both in same group  → select only mods from that group
          // - Both ungrouped      → select only ungrouped mods
          // - Cross-context       → just toggle the clicked key
          const currentGroupMap = modGroupMapRef.current;
          const lastG = currentGroupMap.get(lastClickedKey) ?? null;
          const curG = currentGroupMap.get(key) ?? null;

          let range: string[];
          if (lastG && lastG === curG) {
            // Same group: select group members in the displayOrder range
            const groupMemberSet = new Set(
              groups.find((g) => g.id === lastG)?.modKeys ?? [],
            );
            range = disp
              .slice(Math.min(from, to), Math.max(from, to) + 1)
              .filter((k) => groupMemberSet.has(k));
          } else if (!lastG && !curG) {
            // Both ungrouped: select only ungrouped mods
            const groupIdSet = new Set(groups.map((g) => g.id));
            const groupedSet = new Set<string>();
            for (const g of groups) {
              for (const mk of g.modKeys) groupedSet.add(mk);
            }
            range = disp
              .slice(Math.min(from, to), Math.max(from, to) + 1)
              .filter((k) => !groupIdSet.has(k) && !groupedSet.has(k));
          } else {
            // Cross-context — no range, fall through to toggle
            range = [];
          }

          if (range.length > 0) {
            addModsToSelection(range);
          } else {
            // Cross-context or empty range: clear old selection, start fresh
            selectModOnly(key);
          }
        } else {
          selectModOnly(key);
        }
      } else {
        clearSelection();
        selectModOnly(key);
      }
    },
    [preventClickRef, toggleSelectMod, lastClickedKey, saveEditAndExit,
     displayOrder, groups, addModsToSelection, clearSelection, selectModOnly],
  );

  const handleModDoubleClick = useCallback(
    (key: string) => {
      if (preventClickRef.current) return;
      onSelectMod(key);
    },
    [preventClickRef, onSelectMod],
  );

  // Groups no longer participate in multi-select — clicking clears mod selection
  const handleGroupClick = useCallback(
    () => {
      saveEditAndExit();
      clearSelection();
    },
    [clearSelection, saveEditAndExit],
  );

  // ── Filtered mods ────────────────────────────────────────────────────────
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
          ? result.filter((m) => {
              const combined = [...m.tagList, ...getUserTags(m)];
              return combined.some((t) => filter.activeTags.has(t));
            })
          : result.filter((m) => {
              const combined = [...new Set([...m.tagList, ...getUserTags(m)])];
              return [...filter.activeTags].every((t) => combined.includes(t));
            });
    }

    // ★ v2: user-category filter (AND across selected categories)
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
      const idxA = displayOrder.indexOf(`${a.source}_${a.fileId}`);
      const idxB = displayOrder.indexOf(`${b.source}_${b.fileId}`);
      const rankA = idxA === -1 ? Infinity : idxA;
      const rankB = idxB === -1 ? Infinity : idxB;
      return rankA - rankB || a.title.localeCompare(b.title, "zh");
    });

    return result;
  }, [mods, filter.search, filter.enabledFilter, fuse, filter.activeCategories, filter.activeTags, filter.tagMode, displayOrder, filter.activeCatIds]);

  // ★ v2: split filtered mods into scheme members + pool (dual-view).
  // Without an active scheme, everything is a "member" (legacy global mode).
  const schemeMemberKeys = useMemo(() => {
    if (!activeSchemeModKeys) return null;
    return new Set(activeSchemeModKeys);
  }, [activeSchemeModKeys]);
  const schemeFiltered = schemeMemberKeys
    ? filtered.filter((m) => schemeMemberKeys.has(`${m.source}_${m.fileId}`))
    : filtered;
  const poolFiltered = schemeMemberKeys
    ? filtered.filter((m) => !schemeMemberKeys.has(`${m.source}_${m.fileId}`))
    : [];
  // Pool collapse state (default collapsed)
  const [poolOpen, setPoolOpen] = useState(false);

  const enabledCount = mods.filter((m) => m.enabled).length;

  // ── Refs for context-menu position lookup ───────────────────────────────
  const renderItemsRef = useRef<RenderItem[]>([]);

  // ── Container click: clear selection on interactive elements ────────────
  const handleContainerClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("button, input, label, select")) {
        clearSelection();
        setContextMenu(null);
      }
    },
    [clearSelection],
  );

  // Close context menu when selection changes
  useEffect(() => {
    setContextMenu(null);
  }, [selectedModKeys]);

  // ── Render: loading / error / empty ──────────────────────────────────────
  if (scanning) {
    return (
      <div className="flex flex-col items-center gap-3 py-12">
        <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
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
        <p className="text-xs text-slate-600">请确认游戏路径正确，且已安装 Mod 至 Workshop 或 Mod 目录</p>
      </div>
    );
  }

  // ── Render items ─────────────────────────────────────────────────────────
  const renderItems = buildRenderItems(
    displayOrder,
    groups,
    schemeFiltered,
    modGroupMap,
    groupCreateState,
  );
  // Keep ref in sync (direct assignment during render is safe for refs)
  renderItemsRef.current = renderItems;

  const sourceGroupId =
    dragState?.sourceKey ? (modGroupMap.get(dragState.sourceKey) ?? null) : null;
  const cardInsertLineIdx = computeCardInsertLineIdx(
    dragState, displayOrder, renderItems, sourceGroupId,
  );
  const ghds = groupHeaderDragState;
  const groupInsertLineIdx = computeGroupInsertLineIdx(ghds, displayOrder, renderItems);
  const groupDragCardInsertLineIdx = computeGroupDragCardInsertLineIdx(ghds, renderItems);

  // Card-drag insertion line indentation: indented (ml-6) when
  // dragging within the source card's own group. Full-width when
  // dragging to exit the group or when the card is ungrouped.
  const cardLineIndented = lineIndented;

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <div className="contents" onClick={handleContainerClick}>
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
        userTagColors={filter.userTagColors}
        viewMode={filter.viewMode}
        onToggleViewMode={() =>
          filter.setViewMode((v) => (v === "detailed" ? "compact" : "detailed"))
        }
        onApplyOrder={readOnly ? () => {} : handleApplyOrder}
        onGroupCreateMouseDown={handleGroupCreateMouseDown}
        hideGroupCreate={readOnly}
      />

      {/* Scrollable cards area */}
      <div
        className="flex-1 overflow-y-auto px-6 py-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) clearSelection();
        }}
      >
        <div ref={listRef}>
          {schemeFiltered.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">
              {activeSchemeName ? "当前方案暂无成员 Mod，请从底部可用池添加" : "没有匹配的 Mod"}
            </p>
          ) : (
            renderItems.map((item, index) => {
              // Group creation placeholder — yellow insertion line
              if (item.type === "group-creation-placeholder") {
                return (
                  <div key="group-create-placeholder" className="relative h-0 z-20">
                    <div className="absolute left-1 right-1 -top-[2px] h-[3px] bg-yellow-500 rounded-full shadow-[0_0_6px_rgba(234,179,8,0.7)]" />
                  </div>
                );
              }

              // Group header
              if (item.type === "group-header") {
                const group = item.group;
                return (
                  <div key={group.id} onClick={handleGroupClick}>
                    {index === groupInsertLineIdx && (
                      <div className="relative h-0 z-20">
                        <div className="absolute left-1 right-1 -top-[2px] h-[3px] bg-blue-500 rounded-full shadow-[0_0_6px_rgba(59,130,246,0.7)]" />
                      </div>
                    )}
                    {index === cardInsertLineIdx && (
                      <div className="relative h-0 z-20">
                        <div className="absolute left-1 right-1 -top-[2px] h-[3px] bg-blue-500 rounded-full shadow-[0_0_6px_rgba(59,130,246,0.7)]" />
                      </div>
                    )}
                    <ModGroupHeader
                      group={group}
                      modCount={groupModCounts.get(group.id) ?? 0}
                      isEditing={editingGroupId === group.id}
                      isDragging={
                        !!(groupHeaderDragState?.started &&
                        groupHeaderDragState.sourceGroupId === group.id)
                      }
                      dragOverGroupId={dragOverGroupId}
                      onToggle={handleToggleGroup}
                      onRename={handleRenameGroup}
                      onDelete={handleDeleteGroup}
                      onDragMouseDown={handleGroupHeaderDragMouseDown}
                      onContextMenu={(e, groupId) => {
                        e.preventDefault();
                        setContextMenu({ type: "group", groupId, x: e.clientX, y: e.clientY });
                      }}
                      onStartEdit={(id) => { clearSelection(); setEditingGroupId(id); }}
                      onStopEdit={() => setEditingGroupId(null)}
                    />
                  </div>
                );
              }

              // Mod card
              const mod = item.mod;
              const dragging = dragState?.started && dragState.sourceKey === item.key;

              return (
                <div key={item.key}>
                  {index === cardInsertLineIdx && (
                    <div className={`relative h-0 z-20${cardLineIndented ? ' ml-6' : ''}`}>
                      <div className="absolute left-1 right-1 -top-[2px] h-[3px] bg-blue-500 rounded-full shadow-[0_0_6px_rgba(59,130,246,0.7)]" />
                    </div>
                  )}
                  {index === groupDragCardInsertLineIdx && (
                    <div className="relative h-0 z-20">
                      <div className="absolute left-1 right-1 -top-[2px] h-[3px] bg-blue-500 rounded-full shadow-[0_0_6px_rgba(59,130,246,0.7)]" />
                    </div>
                  )}
                  <div
                    data-mod-key={item.key}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (selectionCount > 1 && selectedModKeys.includes(item.key)) {
                        setContextMenu({
                          type: "multi",
                          x: e.clientX,
                          y: e.clientY,
                        });
                      } else {
                        setContextMenu({ type: "mod", key: item.key, x: e.clientX, y: e.clientY });
                      }
                    }}
                    className={`${item.indented ? "ml-6" : ""} ${
                      dragging
                        ? "scale-[0.98] opacity-40 z-10 relative transition-all duration-200"
                        : ""
                    }`}
                  >
                    <ModCard
                      mod={mod}
                      disabled={saving}
                      onToggle={handleToggle}
                      onSelect={(e) => handleModClick(item.key, e)}
                      onDoubleClick={() => handleModDoubleClick(item.key)}
                      onOrderUp={(e) => {
                        e.stopPropagation();
                        clearSelection();
                        setModOrder(item.key, mod.order + 1);
                        setDirty(true);
                      }}
                      onOrderDown={(e) => {
                        e.stopPropagation();
                        clearSelection();
                        setModOrder(item.key, Math.max(0, mod.order - 1));
                        setDirty(true);
                      }}
                      onOrderChange={(order) => handleOrderChange(item.key, order)}
                      onOrderFocus={() => clearSelection()}
                      onDragMouseDown={handleDragMouseDown}
                      isDragging={dragging}
                      isDragOver={false}
                      isSelected={selectedModKeys.includes(item.key)}
                      viewMode={filter.viewMode}
                      conflicts={conflictMap.get(item.key)}
                      modTitles={modTitles}
                      hideToggleAndOrder={readOnly}
                    />
                  </div>
                </div>
              );
            })
          )}

          {/* End-of-list insertion line — card dropped after last item */}
          {cardInsertLineIdx === renderItems.length && (
            <div className={`relative h-0 z-20${cardLineIndented ? ' ml-6' : ''}`}>
              <div className="absolute left-1 right-1 -top-[2px] h-[3px] bg-blue-500 rounded-full shadow-[0_0_6px_rgba(59,130,246,0.7)]" />
            </div>
          )}

          {/* Footer stats */}
          <div className="flex items-center justify-between px-1 pt-2 text-xs text-slate-500">
            <span>
              共 {mods.length} 个 Mod | {enabledCount} 已启用
              {filtered.length !== mods.length && (
                <span className="text-slate-400"> | 显示 {filtered.length} 个</span>
              )}
            </span>
            {saving && <span className="text-blue-400">保存中...</span>}
          </div>

          {/* ★ v2: Available pool (scheme-outside mods) — collapsed read-only section */}
          {activeSchemeName && (
            <div className="mt-4 border-t border-slate-700/60 pt-2">
              <button
                onClick={() => setPoolOpen((v) => !v)}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-200
                           px-1 py-1.5 rounded cursor-pointer transition-colors w-full text-left"
              >
                <span>{poolOpen ? "▼" : "▶"}</span>
                <span>可用池</span>
                <span className="text-slate-600">
                  （{poolFiltered.length} 个已安装未加入方案）
                </span>
              </button>
              {poolOpen && (
                <div className="space-y-1.5 mt-1">
                  {poolFiltered.length === 0 ? (
                    <p className="text-xs text-slate-600 px-1 py-2">所有已安装 Mod 均已加入方案</p>
                  ) : (
                    poolFiltered.map((m) => {
                      const key = `${m.source}_${m.fileId}`;
                      const residual = m.isResidual;
                      return (
                        <div
                          key={key}
                          className="flex items-center gap-2 rounded-lg border border-slate-700/50
                                     bg-slate-800/30 px-3 py-1.5 opacity-70"
                        >
                          <span className="text-xs text-slate-400 truncate min-w-0 flex-1">
                            {m.title}
                          </span>
                          <span className="text-[10px] text-slate-500 shrink-0">
                            {m.source === 1 ? "工坊" : "本地"}
                          </span>
                          {residual ? (
                            <span
                              className="text-[10px] text-slate-600 shrink-0"
                              title="残留 Mod（Config.lua 缺失或损坏），不可加入方案"
                            >
                              残留
                            </span>
                          ) : (
                            <button
                              onClick={() => {
                                // Add to scheme: enable mod + join member set
                                toggleMod(m.fileId, true);
                                setDirty(true);
                                setActiveSchemeModKeys?.([...(activeSchemeModKeys ?? []), key]);
                              }}
                              className="text-[10px] px-2 py-0.5 bg-blue-600 hover:bg-blue-500
                                         text-white rounded cursor-pointer shrink-0"
                            >
                              加入方案
                            </button>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Context Menus (portalled to body) ──────────────────────────────── */}
      {contextMenu?.type === "mod" && modMenu && (() => {
        const mod = mods.find((m) => `${m.source}_${m.fileId}` === contextMenu.key);
        if (!mod) return null;
        const menuMod = {
          key: contextMenu.key,
          fileId: mod.fileId,
          source: mod.source,
          dirPath: mod.dirPath,
          enabled: mod.enabled,
        };
        return (
          <ModActionMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            modTitle={mod.title}
            mod={menuMod}
            schemes={modMenu.schemes}
            collections={modMenu.collections}
            containerKind="mods"
            onToggle={(enabled) => handleToggle(mod.fileId, enabled)}
            onOpenConfig={() => onSelectMod(contextMenu.key)}
            onAddToScheme={(name) => modMenu.onAddToScheme(name, [contextMenu.key])}
            onAddToCollection={(id) => modMenu.onAddToCollection(id, [contextMenu.key])}
            onCreateScheme={modMenu.onCreateScheme}
            onCreateCollection={modMenu.onCreateCollection}
            onSetCategories={() => setModPopup({ modKey: contextMenu.key, kind: "category" })}
            onEditNote={() => setModPopup({ modKey: contextMenu.key, kind: "note" })}
            onOpenExplorer={() => openInExplorer(mod.dirPath).catch((e) => setLastMessage(String(e)))}
            onOpenWorkshop={() => openSteamWorkshop(mod.fileId).catch((e) => setLastMessage(String(e)))}
          />
        );
      })()}

      {contextMenu?.type === "mod" && !modMenu && (() => {
        const mod = mods.find((m) => `${m.source}_${m.fileId}` === contextMenu.key);
        if (!mod) return null;
        return (
          <ModContextMenu
            modKey={contextMenu.key}
            mod={mod}
            x={contextMenu.x}
            y={contextMenu.y}
            groups={groups}
            currentGroupId={modGroupMap.get(contextMenu.key)}
            onClose={() => setContextMenu(null)}
            onToggle={handleToggle}
            onSendToGroup={handleSendToGroup}
            onCreateGroupAndSend={handleCreateGroupAndSend}
            onOrderUp={() => {
              clearSelection();
              setModOrder(contextMenu.key, Math.max(0, mod.order - 1));
              setDirty(true);
            }}
            onOrderDown={() => {
              clearSelection();
              setModOrder(contextMenu.key, mod.order + 1);
              setDirty(true);
            }}
            onOpenInExplorer={() => openInExplorer(mod.dirPath).catch((e) => setLastMessage(String(e)))}
            onOpenWorkshop={() => openSteamWorkshop(mod.fileId).catch((e) => setLastMessage(String(e)))}
            onViewDetail={() => onSelectMod(contextMenu.key)}
            onEditCategories={() => setModPopup({ modKey: contextMenu.key, kind: "category" })}
            onEditNote={() => setModPopup({ modKey: contextMenu.key, kind: "note" })}
          />
        );
      })()}

      {contextMenu?.type === "group" && (() => {
        const group = groups.find((g) => g.id === contextMenu.groupId);
        if (!group) return null;
        return (
          <GroupContextMenu
            group={group}
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            onRename={(id) => setEditingGroupId(id)}
            onToggleCollapse={handleToggleGroup}
            onDelete={handleDeleteGroup}
            onUngroup={handleUngroup}
          />
        );
      })()}

      {contextMenu?.type === "multi" && (() => {
        const selectedSet = new Set(selectedModKeys);
        const selected = mods.filter((m) => selectedSet.has(`${m.source}_${m.fileId}`));
        const allEnabled = selected.length > 0 && selected.every((m) => m.enabled);
        return (
        <MultiContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          modCount={selectedModKeys.length}
          toggleLabel={allEnabled ? "禁用" : "启用"}
          onClose={() => setContextMenu(null)}
          onToggleAll={handleBatchToggleMods}
          onSendToGroup={handleBatchSendToGroup}
          onOrderUp={handleBatchOrderUp}
          onOrderDown={handleBatchOrderDown}
          groups={groups}
          onSaveAsCollection={() => onSaveSelectionAsCollection?.()}
        />
        );
      })()}

      {/* ★ v2: mod-level category/note popups opened from context menu */}
      {modPopup && (() => {
        const target = mods.find((m) => `${m.source}_${m.fileId}` === modPopup.modKey);
        if (!target) return null;
        return modPopup.kind === "category" ? (
          <CategoryPicker
            modKey={modPopup.modKey}
            title={target.title}
            onClose={() => setModPopup(null)}
          />
        ) : (
          <NoteEditor
            modKey={modPopup.modKey}
            title={target.title}
            onClose={() => setModPopup(null)}
          />
        );
      })()}
    </div>
  );
}
