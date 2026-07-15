import React from "react";
import type { ModInfo, ModGroup } from "../../lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type RenderItem =
  | { type: "group-header"; group: ModGroup }
  | { type: "mod"; mod: ModInfo; key: string; indented: boolean }
  | { type: "group-creation-placeholder"; };

export interface GroupCreateDragState {
  active: boolean;
  startY: number;
  insertAfter: string | null;
  insertBefore: string | null;
}

export interface CardDragState {
  sourceKey: string;
  sourceIdx: number;
  currentIdx: number;
  startY: number;
  started: boolean;
  /** True when dragging a multi-selected card → all selected move together */
  multiDrag?: boolean;
  /** All mod keys being moved in this multi-drag */
  multiDragKeys?: string[];
  /** First index of the multi-drag block in displayOrder */
  multiDragMinIdx?: number;
}

export interface GroupHeaderDragState {
  sourceGroupId: string;
  sourceIdx: number;
  currentIdx: number;
  startY: number;
  started: boolean;
  slotBeforeKey?: string;
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
 * Build a flat RenderItem array from the unified displayOrder.
 * displayOrder contains both mod keys and group IDs interleaved.
 * Group IDs trigger emission of the group header + all members.
 * Grouped mod keys are skipped (they render with their group).
 */
export function buildRenderItems(
  displayOrder: string[],
  groups: ModGroup[],
  filtered: ModInfo[],
  modGroupMap: Map<string, string>,
  groupCreateState: GroupCreateDragState | null,
): RenderItem[] {
  const renderedModKeys = new Set<string>();
  const renderedGroupIds = new Set<string>();
  const items: RenderItem[] = [];
  const groupMap = new Map(groups.map((g) => [g.id, g]));

  // Walk displayOrder linearly
  for (const entry of displayOrder) {
    const group = groupMap.get(entry);
    if (group) {
      // Group ID → emit header + all members
      if (renderedGroupIds.has(entry)) continue;
      renderedGroupIds.add(entry);
      items.push({ type: "group-header", group });

      if (!group.collapsed) {
        // Emit members sorted by displayOrder position, falling back to modKeys order
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
    } else if (!renderedModKeys.has(entry)) {
      // Mod key — emit if not already rendered as part of a group
      const mod = filtered.find((m) => `${m.source}_${m.fileId}` === entry);
      if (mod) {
        const gid = modGroupMap.get(entry);
        // If this mod is in a group whose ID hasn't been rendered yet,
        // skip — it will render when the group is encountered.
        if (gid && !renderedGroupIds.has(gid)) continue;
        items.push({ type: "mod", mod, key: entry, indented: !!gid });
        renderedModKeys.add(entry);
      }
    }
  }

  // Remaining mods not in displayOrder
  for (const mod of filtered) {
    const key = `${mod.source}_${mod.fileId}`;
    if (renderedModKeys.has(key)) continue;
    const gid = modGroupMap.get(key);
    if (gid && !renderedGroupIds.has(gid)) {
      // Group not yet rendered — emit it now
      const group = groupMap.get(gid);
      if (group) {
        renderedGroupIds.add(gid);
        items.push({ type: "group-header", group });
        if (!group.collapsed) {
          for (const mk of group.modKeys) {
            if (renderedModKeys.has(mk)) continue;
            const m = filtered.find((fm) => `${fm.source}_${fm.fileId}` === mk);
            if (m) {
              items.push({ type: "mod", mod: m, key: mk, indented: true });
              renderedModKeys.add(mk);
            }
          }
        } else {
          for (const mk of group.modKeys) renderedModKeys.add(mk);
        }
      }
    }
    if (!renderedModKeys.has(key)) {
      items.push({ type: "mod", mod, key, indented: !!gid });
      renderedModKeys.add(key);
    }
  }

  // Remaining groups not in displayOrder (e.g., from old-format data)
  for (const g of groups) {
    if (!renderedGroupIds.has(g.id)) {
      renderedGroupIds.add(g.id);
      items.push({ type: "group-header", group: g });
      if (!g.collapsed) {
        const sorted = g.modKeys
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
        for (const mk of g.modKeys) renderedModKeys.add(mk);
      }
    }
  }

  // Group creation placeholder — yellow line between cards/groups
  if (groupCreateState?.active) {
    insertGroupCreationPlaceholder(items, groupCreateState);
  }

  return items;
}

function insertGroupCreationPlaceholder(
  items: RenderItem[],
  state: GroupCreateDragState,
): void {
  let idx: number;
  if (state.insertBefore) {
    const found = items.findIndex(
      (item) =>
        (item.type === "mod" && item.key === state.insertBefore) ||
        (item.type === "group-header" && item.group.id === state.insertBefore),
    );
    idx = found === -1 ? 0 : found;
  } else if (state.insertAfter) {
    const found = items.findIndex(
      (item) =>
        (item.type === "mod" && item.key === state.insertAfter) ||
        (item.type === "group-header" && item.group.id === state.insertAfter),
    );
    idx = found === -1 ? items.length : found + 1;
  } else {
    idx = items.length;
  }
  items.splice(idx, 0, { type: "group-creation-placeholder" });
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
  items: RenderItem[],
  sourceGroupId?: string | null,
): number {
  if (!dragState?.started) return -1;

  // No real movement in displayOrder
  if (dragState.currentIdx === dragState.sourceIdx) {
    return -1;
  }

  // Insert after the last card
  if (dragState.currentIdx >= displayOrder.length) {
    return items.length;
  }
  const targetKey = displayOrder[dragState.currentIdx];
  if (!targetKey) return -1;

  let targetIdx = items.findIndex(
    (item) =>
      (item.type === "mod" && item.key === targetKey) ||
      (item.type === "group-header" && item.group.id === targetKey),
  );

  if (targetIdx === -1) return -1;

  // When dragging within a group and the target is outside the source group,
  // position the blue line after the last card in the source group instead.
  if (sourceGroupId) {
    let inSource = false;
    let lastSourceIdx = -1;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type === "group-header") {
        inSource = item.group.id === sourceGroupId;
      } else if (item.type === "mod") {
        if (inSource && item.indented) {
          lastSourceIdx = i;
        } else if (inSource && !item.indented) {
          // Left the source group into ungrouped territory
          inSource = false;
        }
      }
    }
    // If target is past/outside the source group while the source card
    // is still inside it, show the line at end-of-group.
    if (lastSourceIdx >= 0 && targetIdx > lastSourceIdx) {
      // Check whether the target item is visually inside the source group.
      // Ungrouped mods (indented=false) are never in any group.
      let targetInSourceGroup = false;
      const targetItem = items[targetIdx];
      if (targetItem?.type === "mod" && targetItem.indented) {
        for (let i = targetIdx - 1; i >= 0; i--) {
          const it = items[i];
          if (it.type === "group-header") {
            targetInSourceGroup = it.group.id === sourceGroupId;
            break;
          }
        }
      } else if (targetItem?.type === "group-header") {
        targetInSourceGroup = targetItem.group.id === sourceGroupId;
      }
      if (!targetInSourceGroup) {
        return lastSourceIdx + 1;
      }
    }
  }

  return targetIdx;
}

/**
 * Compute the insertion-line position for group header drag (group reorder).
 * Returns the renderItems index *before which* the line should appear.
 * Returns -1 when no line should be shown.
 */
export function computeGroupInsertLineIdx(
  ghds: GroupHeaderDragState | null,
  displayOrder: string[],
  items: RenderItem[],
): number {
  if (!ghds?.started) return -1;

  // No-op detection
  if (ghds.sourceIdx === ghds.currentIdx || ghds.sourceIdx + 1 === ghds.currentIdx) return -1;

  const targetKey = displayOrder[ghds.currentIdx];
  if (!targetKey) return -1;

  return items.findIndex(
    (item) =>
      (item.type === "mod" && item.key === targetKey) ||
      (item.type === "group-header" && item.group.id === targetKey),
  );
}

/**
 * Compute the card-level insertion line for group header drag
 * (when a group's cards are extracted between ungrouped cards).
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
  draggedGroupId?: string;
  groupHeaderHeightRef?: React.MutableRefObject<number>;
  groupDragSlotHeightRef?: React.MutableRefObject<number>;
}

/**
 * Snapshot all card positions and group header positions from the DOM.
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
    if (extras?.draggedGroupId && gid === extras.draggedGroupId && extras.groupHeaderHeightRef) {
      extras.groupHeaderHeightRef.current = rect.height;
    }
  });

  // Compute full visual height of the dragged group
  if (extras?.draggedGroupId && extras.groupDragSlotHeightRef) {
    const ownModKeys = new Set(
      groups.find((g) => g.id === extras.draggedGroupId!)?.modKeys ?? [],
    );
    const ownCards = [...positions.entries()].filter(([k]) => ownModKeys.has(k));
    let totalHeight = extras.groupHeaderHeightRef?.current ?? 42;
    for (const [, pos] of ownCards) totalHeight += pos.height;
    extras.groupDragSlotHeightRef.current = totalHeight;
  }
}

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
