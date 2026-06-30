import React from "react";
import type { ModInfo, ModGroup } from "../../lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RenderItem =
  | { type: "group-header"; group: ModGroup }
  | { type: "mod"; mod: ModInfo; key: string; indented: boolean }
  | { type: "group-creation-placeholder"; group: null };

export interface GroupCreateDragState {
  active: boolean;
  startY: number;
  slotY: number;
  insertAfter: string | null;
  insertBefore: string | null;
  groupOrderIdx: number;
}

export interface CardDragState {
  sourceKey: string;
  sourceIdx: number;
  currentIdx: number;
  startY: number;
  started: boolean;
  slotBeforeGroupId?: string;
  sourceGroupId?: string;
  exitingGroup?: 'top' | 'bottom';
}

export interface GroupHeaderDragState {
  sourceGroupId: string;
  sourceIdx: number;
  currentIdx: number;
  startY: number;
  started: boolean;
  slotBeforeKey?: string;
  insertAfter?: boolean;
}

/** Shared DOM refs used across all drag systems. */
export interface DragRefs {
  listRef: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef: React.MutableRefObject<HTMLElement | null>;
  scrollSnapshotRef: React.MutableRefObject<number>;
  containerRectSnapshotRef: React.MutableRefObject<{
    top: number;
    bottom: number;
  }>;
  cardPositionsRef: React.MutableRefObject<
    Map<string, { top: number; midY: number; height: number }>
  >;
  groupHeaderPositionsRef: React.MutableRefObject<
    Map<string, { top: number; bottom: number }>
  >;
  preventClickRef: React.MutableRefObject<boolean>;
}

// ─── buildRenderItems ────────────────────────────────────────────────────────

/**
 * Build a flat RenderItem array that represents the visual ordering of the
 * mod list. Groups are interleaved with ungrouped mods based on displayOrder:
 * when the first member of a group is encountered, the group header and all
 * its members are emitted contiguously at that position.
 */
export function buildRenderItems(
  displayOrder: string[],
  groups: ModGroup[],
  groupOrder: string[],
  filtered: ModInfo[],
  modGroupMap: Map<string, string>,
  groupCreateState: GroupCreateDragState | null,
): RenderItem[] {
  const renderedModKeys = new Set<string>();
  const renderedGroupIds = new Set<string>();
  const items: RenderItem[] = [];

  // Walk displayOrder — first-encounter triggers full group emission
  for (const key of displayOrder) {
    if (renderedModKeys.has(key)) continue;

    const gid = modGroupMap.get(key);
    if (gid && !renderedGroupIds.has(gid)) {
      emitGroup(gid, displayOrder, groups, groupOrder, filtered, modGroupMap, items, renderedModKeys, renderedGroupIds);
      continue;
    }

    // Ungrouped card
    if (!renderedModKeys.has(key)) {
      const mod = filtered.find((m) => `${m.source}_${m.fileId}` === key);
      if (mod) {
        items.push({ type: "mod", mod, key, indented: false });
        renderedModKeys.add(key);
      }
    }
  }

  // Remaining mods not in displayOrder
  for (const mod of filtered) {
    const key = `${mod.source}_${mod.fileId}`;
    if (renderedModKeys.has(key)) continue;
    const gid = modGroupMap.get(key);
    if (gid && !renderedGroupIds.has(gid)) {
      emitGroup(gid, displayOrder, groups, groupOrder, filtered, modGroupMap, items, renderedModKeys, renderedGroupIds);
    }
    if (!renderedModKeys.has(key)) {
      items.push({ type: "mod", mod, key, indented: false });
      renderedModKeys.add(key);
    }
  }

  // Interpolate unrendered top-level groups
  interpolateUnrenderedGroups(groupOrder, groups, items, renderedGroupIds);

  // Group creation placeholder
  if (groupCreateState?.active) {
    insertGroupCreationPlaceholder(items, groupCreateState);
  }

  return items;
}

function emitGroup(
  gid: string,
  displayOrder: string[],
  groups: ModGroup[],
  groupOrder: string[],
  filtered: ModInfo[],
  modGroupMap: Map<string, string>,
  items: RenderItem[],
  renderedModKeys: Set<string>,
  renderedGroupIds: Set<string>,
): void {
  const group = groups.find((g) => g.id === gid);
  if (!group || !groupOrder.includes(group.id)) return;
  renderedGroupIds.add(gid);

  items.push({ type: "group-header", group });

  if (!group.collapsed) {
    const sorted = group.modKeys
      .map((k) => ({
        key: k,
        mod: filtered.find((m) => `${m.source}_${m.fileId}` === k),
      }))
      .filter((x): x is { key: string; mod: ModInfo } => x.mod != null)
      .sort((a, b) => {
        const ia = displayOrder.indexOf(a.key);
        const ib = displayOrder.indexOf(b.key);
        return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
      });
    for (const { key: mk, mod } of sorted) {
      if (!renderedModKeys.has(mk)) {
        items.push({ type: "mod", mod, key: mk, indented: true });
        renderedModKeys.add(mk);
      }
    }
  } else {
    for (const mk of group.modKeys) renderedModKeys.add(mk);
  }
}

function interpolateUnrenderedGroups(
  groupOrder: string[],
  groups: ModGroup[],
  items: RenderItem[],
  renderedGroupIds: Set<string>,
): void {
  for (let gi = 0; gi < groupOrder.length; gi++) {
    const gid = groupOrder[gi];
    if (renderedGroupIds.has(gid)) continue;
    const group = groups.find((g) => g.id === gid);
    if (!group) continue;

    let insertAt: number;
    if (group.anchorBefore) {
      const idx = items.findIndex(
        (item) => item.type === "mod" && item.key === group.anchorBefore,
      );
      if (idx !== -1) {
        insertAt = idx;
      } else if (group.anchorAfter) {
        // anchorBefore is stale — try anchorAfter instead
        const idx2 = items.findIndex(
          (item) => item.type === "mod" && item.key === group.anchorAfter,
        );
        insertAt = idx2 === -1 ? 0 : idx2 + 1;
      } else {
        insertAt = 0;
      }
    } else if (group.anchorAfter) {
      const idx = items.findIndex(
        (item) => item.type === "mod" && item.key === group.anchorAfter,
      );
      if (idx !== -1) {
        insertAt = idx + 1;
      } else if (group.anchorBefore) {
        // anchorAfter is stale — try anchorBefore instead
        const idx2 = items.findIndex(
          (item) => item.type === "mod" && item.key === group.anchorBefore,
        );
        insertAt = idx2 === -1 ? items.length : idx2;
      } else {
        insertAt = items.length;
      }
    } else if (groupOrder.length === 1) {
      insertAt = 0;
    } else {
      // Try to find the next rendered sibling group to insert before
      insertAt = -1;
      for (let gj = gi + 1; gj < groupOrder.length; gj++) {
        const nextIdx = items.findIndex(
          (item) =>
            item.type === "group-header" && item.group.id === groupOrder[gj],
        );
        if (nextIdx !== -1) {
          insertAt = nextIdx;
          break;
        }
      }
      // If no sibling after, try to find sibling before and insert after it
      if (insertAt === -1) {
        for (let gj = gi - 1; gj >= 0; gj--) {
          const prevIdx = items.findIndex(
            (item) =>
              item.type === "group-header" && item.group.id === groupOrder[gj],
          );
          if (prevIdx !== -1) {
            insertAt = prevIdx + 1;
            break;
          }
        }
      }
      if (insertAt === -1) insertAt = items.length;
    }

    items.splice(insertAt, 0, { type: "group-header", group });
    renderedGroupIds.add(gid);
  }
}

function insertGroupCreationPlaceholder(
  items: RenderItem[],
  state: GroupCreateDragState,
): void {
  let idx: number;
  if (state.insertBefore) {
    const found = items.findIndex(
      (item) => item.type === "mod" && item.key === state.insertBefore,
    );
    idx = found === -1 ? 0 : found;
  } else if (state.insertAfter) {
    const found = items.findIndex(
      (item) => item.type === "mod" && item.key === state.insertAfter,
    );
    idx = found === -1 ? items.length : found + 1;
  } else {
    idx = 0;
  }
  items.splice(idx, 0, { type: "group-creation-placeholder", group: null });
}

// ─── Insertion-line computation ──────────────────────────────────────────────

/**
 * Compute the insertion-line position for card drag.
 * Returns the renderItems index *before which* the line should appear.
 * Returns items.length to show the line after the last item.
 * Returns -1 when no line should be shown.
 */
export function computeCardInsertLineIdx(
  dragState: CardDragState | null,
  displayOrder: string[],
  dragOverGroupId: string | null,
  items: RenderItem[],
): number {
  if (!dragState?.started) return -1;
  // Suppress line for cross-group moves (grouped card → DIFFERENT group).
  // Same-group reorder and ungrouped→group both show the line.
  if (dragOverGroupId && dragState.sourceGroupId && dragOverGroupId !== dragState.sourceGroupId) return -1;

  if (dragState.slotBeforeGroupId) {
    return items.findIndex(
      (item) =>
        item.type === "group-header" &&
        item.group.id === dragState.slotBeforeGroupId,
    );
  }

  if (dragState.sourceIdx !== dragState.currentIdx) {
    // Insert after the last card
    if (dragState.currentIdx >= displayOrder.length) {
      return items.length;
    }
    const targetKey = displayOrder[dragState.currentIdx];
    if (targetKey) {
      return items.findIndex(
        (item) => item.type === "mod" && item.key === targetKey,
      );
    }
  }

  return -1;
}

/**
 * Compute the insertion-line position for group header drag (group reorder).
 * Returns the renderItems index *before which* the line should appear.
 * Returns -1 when no line should be shown.
 */
export function computeGroupInsertLineIdx(
  ghds: GroupHeaderDragState | null,
  groupOrder: string[],
  items: RenderItem[],
): number {
  if (!ghds?.started || ghds.sourceIdx === ghds.currentIdx) return -1;

  const targetGid = groupOrder[ghds.currentIdx];
  if (!targetGid) return -1;

  return items.findIndex(
    (item) => item.type === "group-header" && item.group.id === targetGid,
  );
}

/**
 * Compute the card-level insertion-line position for group header drag
 * (moving group cards between ungrouped cards).
 * Returns the renderItems index *before which* the line should appear.
 * Returns -1 when no line should be shown.
 */
export function computeGroupDragCardInsertLineIdx(
  ghds: GroupHeaderDragState | null,
  items: RenderItem[],
): number {
  if (!ghds?.slotBeforeKey) return -1;
  return items.findIndex(
    (item) => item.type === "mod" && item.key === ghds.slotBeforeKey,
  );
}

// ─── Shared drag infrastructure ──────────────────────────────────────────────

export const DRAG_THRESHOLD = 5;
const SCROLL_ZONE = 80;
const SCROLL_SPEED = 12;

/** Shared auto-scroll when dragging near container edges. */
export function autoScroll(
  e: MouseEvent,
  container: HTMLElement | null,
  refs: DragRefs,
): void {
  if (!container) return;
  const cr = refs.containerRectSnapshotRef.current;
  const topEdge = cr.top + SCROLL_ZONE;
  const bottomEdge = cr.bottom - SCROLL_ZONE;
  if (e.clientY < topEdge) {
    container.scrollBy(0, -(((topEdge - e.clientY) / SCROLL_ZONE) * SCROLL_SPEED));
  } else if (e.clientY > bottomEdge) {
    container.scrollBy(0, ((e.clientY - bottomEdge) / SCROLL_ZONE) * SCROLL_SPEED);
  }
}

export interface SnapshotExtras {
  /** ID of the dragged group, used to compute full visual height. */
  draggedGroupId?: string;
  /** Height ref for the group header row. */
  groupHeaderHeightRef?: React.MutableRefObject<number>;
  /** Height ref for the dragged group's total visual height (header + cards). */
  groupDragSlotHeightRef?: React.MutableRefObject<number>;
}

/**
 * Snapshot all card positions and group header positions from the DOM.
 * Call from mousedown before any re-render can shift layout.
 */
export function snapshotDragPositions(
  refs: DragRefs,
  groups: ModGroup[],
  extras?: SnapshotExtras,
): void {
  const listEl = refs.listRef.current;
  if (!listEl) return;

  // Locate scroll container
  let el: HTMLElement | null = listEl.parentElement;
  while (el) {
    const style = window.getComputedStyle(el);
    if (style.overflowY === "auto" || style.overflowY === "scroll") break;
    el = el.parentElement;
  }
  refs.scrollContainerRef.current = el;
  refs.scrollSnapshotRef.current = el ? el.scrollTop : 0;
  if (el) {
    const cr = el.getBoundingClientRect();
    refs.containerRectSnapshotRef.current = { top: cr.top, bottom: cr.bottom };
  }

  // Card positions
  const positions = refs.cardPositionsRef.current;
  positions.clear();
  const children = listEl.querySelectorAll("[data-mod-key]");
  children.forEach((child) => {
    const k = child.getAttribute("data-mod-key")!;
    const rect = child.getBoundingClientRect();
    positions.set(k, {
      top: rect.top,
      midY: rect.top + rect.height / 2,
      height: rect.height,
    });
  });

  // Group header positions
  const gHeaders = refs.groupHeaderPositionsRef.current;
  gHeaders.clear();
  const headers = listEl.querySelectorAll("[data-folder-id]");
  headers.forEach((header) => {
    const gid = header.getAttribute("data-folder-id")!;
    const rect = header.getBoundingClientRect();
    gHeaders.set(gid, { top: rect.top, bottom: rect.bottom });
    // Capture the dragged group's header height
    if (extras?.draggedGroupId && gid === extras.draggedGroupId && extras.groupHeaderHeightRef) {
      extras.groupHeaderHeightRef.current = rect.height;
    }
  });

  // Compute full visual height of the dragged group (header + cards)
  if (extras?.draggedGroupId && extras.groupDragSlotHeightRef) {
    const ownGroup = groups.find((g) => g.id === extras.draggedGroupId);
    const ownModKeys = new Set(ownGroup?.modKeys ?? []);
    const ownCards = [...positions.entries()].filter(([k]) => ownModKeys.has(k));
    let totalHeight = extras.groupHeaderHeightRef?.current ?? 42;
    for (const [, pos] of ownCards) totalHeight += pos.height;
    extras.groupDragSlotHeightRef.current = totalHeight;
  }
}

/**
 * Factory: create all shared DragRefs in one call.
 * Use in the orchestrator component to avoid boilerplate.
 */
export function createDragRefs(): DragRefs {
  return {
    listRef: React.createRef<HTMLDivElement>(),
    scrollContainerRef: { current: null } as React.MutableRefObject<HTMLElement | null>,
    scrollSnapshotRef: { current: 0 },
    containerRectSnapshotRef: { current: { top: 0, bottom: 0 } },
    cardPositionsRef: { current: new Map() },
    groupHeaderPositionsRef: { current: new Map() },
    preventClickRef: { current: false },
  };
}
