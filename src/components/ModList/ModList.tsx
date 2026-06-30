import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Fuse from "fuse.js";
import { writeModSettings } from "../../lib/tauriApi";
import { useModStore } from "../../store/useModStore";
import { useAppStore } from "../../store/useAppStore";
import type { ModInfo, ModGroup } from "../../lib/types";
import { collectModSettingsData, patchModSettingsLua, generateModSettingsLua } from "../../utils/generateModSettings";
import ModCard from "./ModCard";
import ModFilterBar from "./ModFilterBar";
import ModGroupHeader from "./ModGroupHeader";
import ModContextMenu from "./ModContextMenu";
import GroupContextMenu from "./GroupContextMenu";
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
  gamePath: string;
  onSelectMod: (key: string) => void;
}

/**
 * Find the card visually just before the group's position in displayOrder,
 * to use as an `anchorAfter` — so the empty group reappears right after it.
 */
function findAnchorAfterCard(
  group: ModGroup,
  displayOrder?: string[],
): string | undefined {
  if (!displayOrder) return undefined;
  const groupModSet = new Set(group.modKeys);
  let firstIdx = displayOrder.length;
  for (const mk of group.modKeys) {
    const idx = displayOrder.indexOf(mk);
    if (idx !== -1 && idx < firstIdx) firstIdx = idx;
  }
  for (let i = firstIdx - 1; i >= 0; i--) {
    if (!groupModSet.has(displayOrder[i])) {
      return displayOrder[i];
    }
  }
  return undefined;
}

export default function ModList({ gamePath, onSelectMod }: Props) {
  // ── Store ────────────────────────────────────────────────────────────────
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

  // ── Filter / search state ────────────────────────────────────────────────
  const filter = useModListState(mods);

  // ── Group helpers ────────────────────────────────────────────────────────
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  // ── Context menu state ───────────────────────────────────────────────────
  type ContextMenuState =
    | { type: "mod"; key: string; x: number; y: number }
    | { type: "group"; groupId: string; x: number; y: number }
    | null;
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  const handleDeleteGroup = useCallback(
    (groupId: string) => {
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
      setGroupOrder((prev) => prev.filter((id) => id !== groupId));
    },
    [setGroups, setGroupOrder],
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
    (modKey: string, groupId: string | null, displayOrder?: string[]) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id === groupId) {
            if (g.modKeys.includes(modKey)) return g;
            const wasEmpty = g.modKeys.length === 0;
            return {
              ...g,
              modKeys: [...g.modKeys, modKey],
              anchorBefore: wasEmpty ? undefined : g.anchorBefore,
              anchorAfter: wasEmpty ? undefined : g.anchorAfter,
            };
          }
          const filtered = g.modKeys.filter((k) => k !== modKey);
          // Last mod leaving → anchor the empty group to the card just before
          // its original visual position, so it stays in place.
          if (filtered.length === 0 && g.modKeys.length > 0) {
            const anchor = findAnchorAfterCard(g, displayOrder);
            return {
              ...g,
              modKeys: [],
              anchorBefore: undefined,
              anchorAfter: anchor,
            };
          }
          return { ...g, modKeys: filtered };
        }),
      );
    },
    [setGroups],
  );

  // ── Context menu action handlers ──────────────────────────────────────────

  const handleSendToGroup = useCallback(
    (modKey: string, targetGroupId: string) => {
      const targetGroup = groups.find((g) => g.id === targetGroupId);
      const wasEmpty = targetGroup ? targetGroup.modKeys.length === 0 : false;
      const order = filter.displayOrder;

      // Compute insertion position BEFORE state changes (avoids stale closure)
      let insertAfterIdx = -1;
      if (wasEmpty && targetGroup) {
        // Empty group: use anchor to find where the group visually sits
        if (targetGroup.anchorBefore && order.indexOf(targetGroup.anchorBefore) !== -1) {
          insertAfterIdx = order.indexOf(targetGroup.anchorBefore) - 1;
        } else if (targetGroup.anchorAfter && order.indexOf(targetGroup.anchorAfter) !== -1) {
          insertAfterIdx = order.indexOf(targetGroup.anchorAfter);
        } else {
          // No valid anchors — find the empty group's visual position from renderItems
          const items = renderItemsRef.current;
          const headerIdx = items.findIndex(
            (item) => item.type === "group-header" && item.group.id === targetGroupId,
          );
          if (headerIdx !== -1) {
            // Look for the nearest mod card before the group header
            for (let i = headerIdx - 1; i >= 0; i--) {
              const ri = items[i];
              if (ri.type === "mod") {
                insertAfterIdx = order.indexOf(ri.key);
                break;
              }
            }
            // If no mod before, look for the nearest mod after and insert before it
            if (insertAfterIdx === -1) {
              for (let i = headerIdx + 1; i < items.length; i++) {
                const ri = items[i];
                if (ri.type === "mod") {
                  insertAfterIdx = order.indexOf(ri.key) - 1;
                  break;
                }
              }
            }
          }
        }
      } else if (targetGroup) {
        // Non-empty group: insert after the last member
        for (const mk of targetGroup.modKeys) {
          const idx = order.indexOf(mk);
          if (idx > insertAfterIdx) insertAfterIdx = idx;
        }
      }

      // Move mod to target group (pass displayOrder so source group gets proper anchors)
      handleMoveToGroup(modKey, targetGroupId, order);

      // Reposition in displayOrder atomically.
      // Must account for index shift: when modKey is removed from prev,
      // elements after it shift left by 1, so the pre-computed insertAfterIdx
      // may be off by one if modKey was before the target position.
      const finalInsertAfterIdx = insertAfterIdx;
      filter.setDisplayOrder((prev) => {
        const next = prev.filter((k) => k !== modKey);
        if (finalInsertAfterIdx === -1) {
          next.push(modKey);
        } else {
          const modKeyOldIdx = prev.indexOf(modKey);
          const shift = (modKeyOldIdx !== -1 && modKeyOldIdx <= finalInsertAfterIdx) ? 0 : 1;
          const insertAt = Math.min(finalInsertAfterIdx + shift, next.length);
          next.splice(insertAt, 0, modKey);
        }
        return next;
      });
    },
    [handleMoveToGroup, groups, filter.displayOrder, filter.setDisplayOrder],
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
      setGroupOrder((prev) => [...prev, newGroup.id]);
      // Trigger rename for the new group
      setTimeout(() => setEditingGroupId(newGroup.id), 0);
    },
    [setGroups, setGroupOrder],
  );

  const handleUngroup = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (!group) return;
      // Pass displayOrder so the emptied group gets a valid anchorAfter
      const order = filter.displayOrder;
      for (const mk of group.modKeys) {
        handleMoveToGroup(mk, null, order);
      }
    },
    [groups, handleMoveToGroup, filter.displayOrder],
  );

  // modKey → group lookup
  const modGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    groups.forEach((g) => g.modKeys.forEach((k) => map.set(k, g.id)));
    return map;
  }, [groups]);
  const modGroupMapRef = useRef(modGroupMap);
  useLayoutEffect(() => { modGroupMapRef.current = modGroupMap; });

  const groupOrderRef = useRef(groupOrder);
  useLayoutEffect(() => { groupOrderRef.current = groupOrder; });

  // ── Persist prefs ────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      localStorage.setItem(
        "twm-filter-prefs",
        JSON.stringify({
          sortKey: "custom",
          activeCategories: [...filter.activeCategories],
          tagMode: filter.tagMode,
          viewMode: filter.viewMode,
          groups,
          displayOrder: filter.displayOrder,
          groupOrder,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [filter.activeCategories, filter.tagMode, filter.viewMode, groups, filter.displayOrder, groupOrder]);

  // Sync groupOrder when groups change
  useEffect(() => {
    const groupIdSet = new Set(groups.map((g) => g.id));
    let changed = false;
    const filtered = groupOrder.filter((id) => {
      const ok = groupIdSet.has(id);
      if (!ok) changed = true;
      return ok;
    });
    for (const g of groups) {
      if (!filtered.includes(g.id)) {
        filtered.push(g.id);
        changed = true;
      }
    }
    if (changed) setGroupOrder(filtered);
  }, [groups, groupOrder, setGroupOrder]);

  // ── Save settings ────────────────────────────────────────────────────────
  const saveModSettings = useCallback(async () => {
    const data = collectModSettingsData(useModStore.getState().mods);
    const lua = templateRaw ? patchModSettingsLua(templateRaw, data) : generateModSettingsLua(data);
    setSaving(true);
    try {
      await writeModSettings(gamePath, lua);
    } catch (e) {
      setLastMessage(`保存失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [gamePath, setLastMessage, templateRaw]);

  const handleOrderChange = useCallback(
    (key: string, order: number) => {
      setModOrder(key, order);
      saveModSettings();
    },
    [setModOrder, saveModSettings],
  );

  const handleApplyOrder = useCallback(() => {
    const currentMods = useModStore.getState().mods;
    const keyModMap = new Map(currentMods.map((m) => [`${m.source}_${m.fileId}`, m]));
    const updates: [string, number][] = [];

    let nextOrder = 0;
    const emittedGroups = new Set<string>();

    // Walk displayOrder — when a group is first encountered, emit ALL its
    // members contiguously (sorted by displayOrder), matching visual rendering.
    for (const key of filter.displayOrder) {
      if (!keyModMap.has(key)) continue;

      const gid = modGroupMap.get(key);
      if (gid) {
        if (emittedGroups.has(gid)) continue;
        emittedGroups.add(gid);
        const group = groups.find((g) => g.id === gid);
        if (group) {
          const sorted = group.modKeys
            .filter((mk) => keyModMap.has(mk))
            .sort((a, b) => filter.displayOrder.indexOf(a) - filter.displayOrder.indexOf(b));
          for (const mk of sorted) {
            const mod = keyModMap.get(mk)!;
            if (mod.enabled) updates.push([mk, nextOrder++]);
            keyModMap.delete(mk);
          }
        }
      } else {
        const mod = keyModMap.get(key)!;
        if (mod.enabled) updates.push([key, nextOrder++]);
        keyModMap.delete(key);
      }
    }

    // Remaining enabled mods not in displayOrder
    for (const [key, mod] of keyModMap) {
      if (mod.enabled) updates.push([key, nextOrder++]);
    }

    for (const [key, order] of updates) setModOrder(key, order);
    saveModSettings();
    setLastMessage(`已应用加载顺序 — ${updates.length} 个已启用 Mod 从 0 递增`);
  }, [filter.displayOrder, groups, modGroupMap, setModOrder, saveModSettings, setLastMessage]);

  // ── Drag refs (shared across all drag systems) ────────────────────────────
  const dragRefs: DragRefs = useMemo(() => createDragRefs(), []);
  const listRef = dragRefs.listRef;
  const preventClickRef = dragRefs.preventClickRef;

  // ── Drag hooks ───────────────────────────────────────────────────────────
  const {
    dragState,
    dragOverGroupId,
    handleDragMouseDown,
  } = useCardDrag({
    displayOrder: filter.displayOrder,
    setDisplayOrder: filter.setDisplayOrder,
    groups,
    modGroupMapRef,
    groupOrderRef,
    handleMoveToGroup,
    refs: dragRefs,
  });

  const {
    groupHeaderDragState,
    handleGroupHeaderDragMouseDown,
  } = useGroupHeaderDrag({
    groupOrder,
    setGroupOrder,
    groups,
    setGroups,
    setDisplayOrder: filter.setDisplayOrder,
    refs: dragRefs,
  });

  const { groupCreateState, handleGroupCreateMouseDown } = useGroupCreateDrag({
    setGroups,
    setGroupOrder,
    setEditingGroupId,
    modGroupMapRef,
    groupOrderRef,
    groups,
    refs: dragRefs,
  });

  // ── Toggle handler ───────────────────────────────────────────────────────
  const handleToggle = useCallback(
    async (fileId: number, enabled: boolean) => {
      toggleMod(fileId, enabled);
      const updatedMods = useModStore.getState().mods;
      const data = collectModSettingsData(updatedMods);
      const lua = templateRaw ? patchModSettingsLua(templateRaw, data) : generateModSettingsLua(data);
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
          ? result.filter((m) => m.tagList.some((t) => filter.activeTags.has(t)))
          : result.filter((m) => [...filter.activeTags].every((t) => m.tagList.includes(t)));
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
  }, [mods, filter.search, filter.enabledFilter, fuse, filter.activeCategories, filter.activeTags, filter.tagMode, filter.displayOrder]);

  const enabledCount = mods.filter((m) => m.enabled).length;

  // ── Refs for context-menu position lookup ───────────────────────────────
  const renderItemsRef = useRef<RenderItem[]>([]);

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
    filter.displayOrder,
    groups,
    groupOrder,
    filtered,
    modGroupMap,
    groupCreateState,
  );
  // Keep ref in sync (direct assignment during render is safe for refs)
  renderItemsRef.current = renderItems;

  const cardInsertLineIdx = computeCardInsertLineIdx(dragState, filter.displayOrder, dragOverGroupId, renderItems);
  const ghds = groupHeaderDragState;
  const groupInsertLineIdx = computeGroupInsertLineIdx(ghds, groupOrder, renderItems);
  const groupDragCardInsertLineIdx = computeGroupDragCardInsertLineIdx(ghds, renderItems);

  // Card-drag insertion line indentation: indented (ml-6) for within-group
  // reorder or when an ungrouped card is entering a group.
  const cardLineIndented = dragState?.started && (
    (dragState.sourceGroupId != null && dragState.exitingGroup == null) ||
    dragOverGroupId != null
  );

  // ── Main render ──────────────────────────────────────────────────────────
  return (
    <>
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
        onToggleViewMode={() =>
          filter.setViewMode((v) => (v === "detailed" ? "compact" : "detailed"))
        }
        onApplyOrder={handleApplyOrder}
        onGroupCreateMouseDown={handleGroupCreateMouseDown}
      />

      {/* Scrollable cards area */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div ref={listRef}>
          {filtered.length === 0 ? (
            <p className="text-sm text-slate-500 text-center py-8">没有匹配的 Mod</p>
          ) : (
            renderItems.map((item, index) => {
              // Group creation placeholder — thin insertion line
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
                  <Fragment key={group.id}>
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
                      onStartEdit={setEditingGroupId}
                      onStopEdit={() => setEditingGroupId(null)}
                    />
                  </Fragment>
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
                      setContextMenu({ type: "mod", key: item.key, x: e.clientX, y: e.clientY });
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
                      viewMode={filter.viewMode}
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
        </div>
      </div>

      {/* ── Context Menus (portalled to body) ──────────────────────────────── */}
      {contextMenu?.type === "mod" && (() => {
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
            onToggle={toggleMod}
            onSendToGroup={handleSendToGroup}
            onCreateGroupAndSend={handleCreateGroupAndSend}
            onOrderUp={() => {
              setModOrder(contextMenu.key, Math.max(0, mod.order - 1));
              saveModSettings();
            }}
            onOrderDown={() => {
              setModOrder(contextMenu.key, mod.order + 1);
              saveModSettings();
            }}
            onOpenInExplorer={() => openInExplorer(mod.dirPath).catch(() => {})}
            onOpenWorkshop={() => openSteamWorkshop(mod.fileId).catch(() => {})}
            onViewDetail={() => onSelectMod(contextMenu.key)}
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
    </>
  );
}
