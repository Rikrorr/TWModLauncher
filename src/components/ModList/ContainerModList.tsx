import { useMemo, useState } from "react";
import type { ModGroup, ModInfo } from "../../lib/types";
import { useModListState, type CategoryKey } from "./useModListState";
import { getUserTags } from "../../utils/userTags";
import ModFilterBar from "./ModFilterBar";
import ModCard from "./ModCard";
import ModGroupHeader from "./ModGroupHeader";
import GroupContextMenu from "./GroupContextMenu";
import type { ConflictGroup } from "../../hooks/useConflictDetection";

interface Props {
  /** Member mods to display (already overlaid with container's enabled/order). */
  mods: ModInfo[];
  /** Container groups (scheme/collection). */
  groups: ModGroup[];
  /** Unified display order (mod keys + group ids interleaved). */
  displayOrder: string[];
  /** Conflict map for badges. */
  conflictMap?: Map<string, ConflictGroup[]>;
  /** modKey → title map. */
  modTitles?: Record<string, string>;
  /** Group id → member keys (derived from groups). */
  onToggle?: (fileId: number, enabled: boolean) => void;
  onOrderChange?: (key: string, order: number) => void;
  onContextMenu?: (e: React.MouseEvent, mod: ModInfo, key: string) => void;
  onOpenConfig?: (key: string) => void;
  /** Group mutations (write back to container data). */
  onGroupsChange: (groups: ModGroup[]) => void;
  onDisplayOrderChange: (order: string[]) => void;
  onMoveToGroup: (modKey: string, groupId: string | null) => void;
  /** Apply display order to modOrder (0,1,2...). */
  onApplyOrder?: () => void;
  readOnly?: boolean;
  allowOrder?: boolean;
}

/**
 * Container member list — same rendering/group/drag stack as the read-Mods
 * page (ModFilterBar + ModGroupHeader + ModCard + buildRenderItems), but data
 * is bound to a container (scheme/collection) via props instead of global stores.
 */
export default function ContainerModList({
  mods,
  groups,
  displayOrder,
  conflictMap,
  modTitles,
  onToggle,
  onOrderChange,
  onContextMenu,
  onOpenConfig,
  onGroupsChange,
  onDisplayOrderChange,
  onMoveToGroup,
  onApplyOrder,
  readOnly,
  allowOrder,
}: Props) {
  const filter = useModListState(mods);

  // ── Filtered (same pipeline as ModList) ────────────────────────────────
  const filtered = useMemo(() => {
    let result = mods;
    if (filter.search.trim()) {
      const q = filter.search.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.author.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q),
      );
    }
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
      const idxA = displayOrder.indexOf(`${a.source}_${a.fileId}`);
      const idxB = displayOrder.indexOf(`${b.source}_${b.fileId}`);
      const rankA = idxA === -1 ? Infinity : idxA;
      const rankB = idxB === -1 ? Infinity : idxB;
      return rankA - rankB || a.title.localeCompare(b.title, "zh");
    });
    return result;
  }, [mods, filter.search, filter.enabledFilter, filter.activeCategories, filter.activeTags, filter.tagMode, displayOrder]);

  // modKey → group map
  const modGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) for (const k of g.modKeys) map.set(k, g.id);
    return map;
  }, [groups]);

  // ── Group creation ──────────────────────────────────────────────────────
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ gid: string; x: number; y: number } | null>(null);

  const createGroup = () => {
    const gid = crypto.randomUUID();
    onGroupsChange([...groups, { id: gid, name: "新建分组", collapsed: false, modKeys: [] }]);
    onDisplayOrderChange([...displayOrder, gid]);
    setEditingGroupId(gid);
  };

  const renameGroup = (gid: string, name: string) =>
    onGroupsChange(groups.map((g) => (g.id === gid ? { ...g, name } : g)));
  const toggleCollapse = (gid: string) =>
    onGroupsChange(groups.map((g) => (g.id === gid ? { ...g, collapsed: !g.collapsed } : g)));
  const deleteGroup = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    if (g) for (const mk of g.modKeys) onMoveToGroup(mk, null);
    onGroupsChange(groups.filter((x) => x.id !== gid));
    onDisplayOrderChange(displayOrder.filter((k) => k !== gid));
  };
  const ungroupAll = (gid: string) => {
    const g = groups.find((x) => x.id === gid);
    if (!g) return;
    for (const mk of g.modKeys) onMoveToGroup(mk, null);
  };

  // ── HTML5 drag & drop: reorder cards + enter groups ────────────────────
  const [dragKey, setDragKey] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, key: string) => {
    setDragKey(key);
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", key); } catch { /* ignore */ }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDropOnCard = (e: React.DragEvent, targetKey: string) => {
    e.preventDefault();
    const src = dragKey ?? e.dataTransfer.getData("text/plain");
    setDragKey(null);
    if (!src || src === targetKey) return;
    const order = [...displayOrder];
    const si = order.indexOf(src);
    const ti = order.indexOf(targetKey);
    if (si === -1 || ti === -1) return;
    order.splice(si, 1);
    const ti2 = order.indexOf(targetKey);
    order.splice(ti2 + (si < ti ? 1 : 0), 0, src);
    onDisplayOrderChange(order);
  };

  const handleDropOnGroup = (e: React.DragEvent, gid: string) => {
    e.preventDefault();
    const src = dragKey ?? e.dataTransfer.getData("text/plain");
    setDragKey(null);
    if (!src) return;
    const currentGid = modGroupMap.get(src);
    if (currentGid !== gid) onMoveToGroup(src, gid);
  };

  // ── Render items (group headers + cards, interleaved by displayOrder) ──
  const renderItems = useMemo(() => {
    const items: { type: "group" | "mod"; key: string; group?: ModGroup; mod?: ModInfo }[] = [];
    const filteredKeys = new Set(filtered.map((m) => `${m.source}_${m.fileId}`));
    const emittedMods = new Set<string>();
    for (const key of displayOrder) {
      const group = groups.find((g) => g.id === key);
      if (group) {
        items.push({ type: "group", key, group });
        for (const mk of group.modKeys) {
          if (filteredKeys.has(mk) && !emittedMods.has(mk)) {
            const mod = mods.find((m) => `${m.source}_${m.fileId}` === mk);
            if (mod) {
              items.push({ type: "mod", key: mk, mod });
              emittedMods.add(mk);
            }
          }
        }
      } else if (filteredKeys.has(key) && !emittedMods.has(key)) {
        const mod = mods.find((m) => `${m.source}_${m.fileId}` === key);
        if (mod) {
          items.push({ type: "mod", key, mod });
          emittedMods.add(key);
        }
      }
    }
    // Append filtered mods not in displayOrder (new members)
    for (const m of filtered) {
      const key = `${m.source}_${m.fileId}`;
      if (!emittedMods.has(key)) {
        items.push({ type: "mod", key, mod: m });
        emittedMods.add(key);
      }
    }
    return items;
  }, [displayOrder, groups, filtered, mods]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
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
        onApplyOrder={onApplyOrder ?? (() => {})}
        onGroupCreateMouseDown={() => {}}
        onGroupCreateClick={createGroup}
        hideGroupCreate={readOnly}
      />

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {renderItems.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-12">暂无成员</p>
        )}
        {renderItems.map((item) => {
          if (item.type === "group" && item.group) {
            const g = item.group;
            return (
              <div
                key={g.id}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnGroup(e, g.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setGroupMenu({ gid: g.id, x: e.clientX, y: e.clientY });
                }}
              >
                <ModGroupHeader
                  group={g}
                  modCount={g.modKeys.length}
                  isEditing={editingGroupId === g.id}
                  isDragging={false}
                  dragOverGroupId={null}
                  onToggle={toggleCollapse}
                  onRename={renameGroup}
                  onDelete={deleteGroup}
                  onDragMouseDown={() => {}}
                  onContextMenu={(e, gid) => {
                    e.preventDefault();
                    setGroupMenu({ gid, x: e.clientX, y: e.clientY });
                  }}
                  onStartEdit={(id) => setEditingGroupId(id)}
                  onStopEdit={() => setEditingGroupId(null)}
                />
                {!g.collapsed &&
                  g.modKeys.map((mk: string) => {
                    const mod = mods.find((m) => `${m.source}_${m.fileId}` === mk);
                    if (!mod) return null;
                    const inFiltered = filtered.some((m) => `${m.source}_${m.fileId}` === mk);
                    if (!inFiltered) return null;
                    return (
                      <div
                        key={mk}
                        className="ml-6"
                        draggable={!readOnly}
                        onDragStart={(e) => handleDragStart(e, mk)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDropOnCard(e, mk)}
                      >
                        <ModCardShell
                          mod={mod}
                          conflictMap={conflictMap}
                          modTitles={modTitles}
                          readOnly={readOnly}
                          allowOrder={allowOrder}
                          onToggle={onToggle}
                          onOrderChange={onOrderChange}
                          onContextMenu={onContextMenu}
                          onOpenConfig={onOpenConfig}
                          viewMode={filter.viewMode}
                        />
                      </div>
                    );
                  })}
              </div>
            );
          }
          if (item.type === "mod" && item.mod) {
            const key = item.key;
            return (
              <div
                key={key}
                draggable={!readOnly}
                onDragStart={(e) => handleDragStart(e, key)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnCard(e, key)}
              >
                <ModCardShell
                  mod={item.mod}
                  conflictMap={conflictMap}
                  modTitles={modTitles}
                  readOnly={readOnly}
                  allowOrder={allowOrder}
                  onToggle={onToggle}
                  onOrderChange={onOrderChange}
                  onContextMenu={onContextMenu}
                  onOpenConfig={onOpenConfig}
                  viewMode={filter.viewMode}
                />
              </div>
            );
          }
          return null;
        })}
      </div>

      {groupMenu && (() => {
        const g = groups.find((x) => x.id === groupMenu.gid);
        if (!g) return null;
        return (
          <GroupContextMenu
            group={g}
            x={groupMenu.x}
            y={groupMenu.y}
            onClose={() => setGroupMenu(null)}
            onRename={(id) => setEditingGroupId(id)}
            onToggleCollapse={toggleCollapse}
            onDelete={deleteGroup}
            onUngroup={() => ungroupAll(g.id)}
          />
        );
      })()}
    </div>
  );
}

interface ShellProps {
  mod: ModInfo;
  conflictMap?: Map<string, ConflictGroup[]>;
  modTitles?: Record<string, string>;
  readOnly?: boolean;
  allowOrder?: boolean;
  onToggle?: (fileId: number, enabled: boolean) => void;
  onOrderChange?: (key: string, order: number) => void;
  onContextMenu?: (e: React.MouseEvent, mod: ModInfo, key: string) => void;
  onOpenConfig?: (key: string) => void;
  viewMode: "detailed" | "compact";
}

function ModCardShell({
  mod,
  conflictMap,
  modTitles,
  readOnly,
  allowOrder,
  onToggle,
  onOrderChange,
  onContextMenu,
  onOpenConfig,
  viewMode,
}: ShellProps) {
  const key = `${mod.source}_${mod.fileId}`;
  return (
    <div
      onContextMenu={
        onContextMenu ? (e) => onContextMenu(e, mod, key) : undefined
      }
    >
      <ModCard
        mod={mod}
        disabled={readOnly}
        onToggle={(fileId, enabled) => onToggle?.(fileId, enabled)}
        onSelect={() => {}}
        onDoubleClick={onOpenConfig ? () => onOpenConfig(key) : undefined}
        onOrderUp={
          readOnly && !allowOrder ? undefined : () => onOrderChange?.(key, mod.order + 1)
        }
        onOrderDown={
          readOnly && !allowOrder ? undefined : () => onOrderChange?.(key, Math.max(0, mod.order - 1))
        }
        onOrderChange={
          readOnly && !allowOrder ? undefined : (order) => onOrderChange?.(key, order)
        }
        conflicts={conflictMap?.get(key)}
        modTitles={modTitles}
        viewMode={viewMode}
        hideToggleAndOrder={readOnly && !allowOrder}
      />
    </div>
  );
}
