import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModGroup } from "../../lib/types";
import { createLogger } from "../../lib/logger";
import { useModStore } from "../../store/useModStore";
import {
  autoScroll,
  snapshotDragPositions,
  DRAG_THRESHOLD,
  type CardDragState,
  type DragRefs,
} from "./utils";

const log = createLogger("useCardDrag");

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Move `keys` from `sourceIdx` to `targetIdx` in displayOrder. */
function moveKeysInDisplayOrder(
  displayOrder: string[],
  keys: string[],
  sourceIdx: number,
  targetIdx: number,
): string[] | null {
  if (sourceIdx === targetIdx || keys.length === 0) return null;
  const next = [...displayOrder];
  const removed: string[] = [];
  for (const k of keys) {
    const i = next.indexOf(k);
    if (i !== -1) removed.push(...next.splice(i, 1));
  }
  if (removed.length === 0) return null;
  let insertAt = targetIdx;
  if (targetIdx > sourceIdx) {
    insertAt = Math.max(0, targetIdx - removed.length);
  }
  insertAt = Math.min(insertAt, next.length);
  next.splice(insertAt, 0, ...removed);
  return next;
}

interface UseCardDragParams {
  displayOrder: string[];
  setDisplayOrder: React.Dispatch<React.SetStateAction<string[]>>;
  groups: ModGroup[];
  modGroupMapRef: React.MutableRefObject<Map<string, string>>;
  handleMoveToGroup: (modKey: string, groupId: string | null) => void;
  refs: DragRefs;
  /** ★ controlled: selection source (defaults to global mod store). */
  selectedModKeys?: string[];
  clearSelection?: () => void;
}

export function useCardDrag({
  displayOrder,
  setDisplayOrder,
  groups,
  modGroupMapRef,
  handleMoveToGroup,
  refs,
  selectedModKeys: controlledSelected,
  clearSelection: controlledClear,
}: UseCardDragParams) {
  const [dragState, setDragState] = useState<CardDragState | null>(null);
  const dragStateRef = useRef(dragState);
  useLayoutEffect(() => { dragStateRef.current = dragState; });

  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const dragOverGroupRef = useRef<string | null>(null);

  const [lineIndented, setLineIndented] = useState(false);

  const displayOrderRef = useRef(displayOrder);
  useLayoutEffect(() => { displayOrderRef.current = displayOrder; });

  const handleDragMouseDown = useCallback(
    // eslint-disable-next-line react-hooks/immutability -- refs mutation in event handler is intended drag pattern
    (e: React.MouseEvent, key: string) => {
      // All mod keys (grouped or not) live in the unified displayOrder.
      const idx = displayOrder.indexOf(key);
      if (idx === -1) {
        log.info(`[drag] mousedown skipped: key not in displayOrder ${key}`);
        return;
      }
      log.info(`[drag] mousedown start key=${key} idx=${idx}`);
      e.preventDefault();
      // eslint-disable-next-line react-hooks/immutability
      refs.preventClickRef.current = true;

      // Snapshot all DOM positions
      snapshotDragPositions(refs, groups);

      // Dragging a card that is not part of the current selection clears
      // the selection — the drag signals "I want to work with THIS card".
      // Skip when modifier keys are held: the click handler will handle
      // Shift/Ctrl/Meta selection — clearing here would nuke lastClickedKey.
      const storeSelection = controlledSelected ?? useModStore.getState().selectedModKeys;
      if (!storeSelection.includes(key) && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        (controlledClear ?? (() => useModStore.getState().clearSelection()))();
      }

      let multiDrag = false;
      let multiDragKeys: string[] = [];
      let multiDragMinIdx = idx;

      if (storeSelection.length > 1 && storeSelection.includes(key)) {
        multiDrag = true;
        multiDragKeys = [...storeSelection];
        for (const sk of multiDragKeys) {
          const si = displayOrder.indexOf(sk);
          if (si !== -1 && si < multiDragMinIdx) multiDragMinIdx = si;
        }
        log.info(`[drag] multi-drag detected: ${multiDragKeys.length} keys, minIdx=${multiDragMinIdx}`);
      }

      setLineIndented(false);
      setDragState({
        sourceKey: key,
        sourceIdx: idx,
        currentIdx: idx,
        startY: e.clientY,
        started: false,
        multiDrag,
        multiDragKeys: multiDragKeys.length > 0 ? multiDragKeys : undefined,
        multiDragMinIdx: multiDrag ? multiDragMinIdx : undefined,
      });
    },
    // ★ v2.1: controlledSelected/controlledClear must be fresh — a stale closure
    // (first-render empty selection) made multiDrag always false and wiped the
    // user's real multi-selection before the drag.
    [displayOrder, groups, modGroupMapRef, refs, controlledSelected, controlledClear],
  );

  // ── Event listener lifecycle ──
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      // Threshold check
      const dy = Math.abs(e.clientY - ds.startY);
      if (!ds.started && dy < DRAG_THRESHOLD) return;

      // Auto-scroll + scrollDelta
      const container = refs.scrollContainerRef.current;
      autoScroll(e, container, refs);
      const scrollDelta = container
        ? container.scrollTop - refs.scrollSnapshotRef.current
        : 0;

      // Detect which group the cursor is in (for enter-group / green highlight).
      //   - Top 40% of header  → "slot before group"  → blue line only
      //   - Bottom 60% of header → "enter group" (other groups) / reorder (own group)
      //   - Over group cards      → "enter group" (other groups) / reorder (own group)
      // Own-group enter-zone keeps membership for mouseup (via ref), but the UI
      // (dragOverGroupId state) suppresses green highlight to avoid blue+green clash.
      const groupHeaders = refs.groupHeaderPositionsRef.current;
      const positions = refs.cardPositionsRef.current;
      const sourceGroupId = ds ? (modGroupMapRef.current.get(ds.sourceKey) ?? null) : null;

      dragOverGroupRef.current = null;
      groupHeaders.forEach((gh, gid) => {
        const headerTop = gh.top - scrollDelta;
        const headerBottom = gh.bottom - scrollDelta;

        // Compute full group bottom (header + cards)
        let groupBottom = headerBottom;
        for (const [cardKey, pos] of positions) {
          const cardGid = modGroupMapRef.current.get(cardKey) ?? null;
          if (cardGid === gid) {
            const b = pos.top + pos.height - scrollDelta;
            if (b > groupBottom) groupBottom = b;
          }
        }

        // Enter-group zone: bottom 60% of header, or anywhere below header (cards area)
        const enterZoneTop = headerTop + (headerBottom - headerTop) * 0.4;
        if (e.clientY >= enterZoneTop && e.clientY <= groupBottom) {
          dragOverGroupRef.current = gid;
        }
      });
      // Green highlight only for groups DIFFERENT from the source card's group.
      // The ref still tracks own-group so mouseup keeps membership on intra-group drop.
      const hoveringOverGroup = dragOverGroupRef.current;
      setDragOverGroupId(
        hoveringOverGroup && hoveringOverGroup !== sourceGroupId
          ? hoveringOverGroup
          : null,
      );
      // Blue line indented only when dragging within the source card's own group
      setLineIndented(sourceGroupId !== null && hoveringOverGroup === sourceGroupId);

      // Build combined visual items: cards + group headers, sorted by visual position.
      const multiKeys = ds.multiDragKeys;
      const disp = displayOrderRef.current;

      interface VisualItem {
        key: string;
        top: number;
        bottom: number;
        midY: number;
      }

      const visualItems: VisualItem[] = [];

      // Add card positions (all cards, grouped or not — their keys are in displayOrder)
      positions.forEach((pos, k) => {
        if (k === ds.sourceKey) return;
        if (multiKeys?.includes(k)) return;
        visualItems.push({
          key: k,
          top: pos.top - scrollDelta,
          bottom: pos.top + pos.height - scrollDelta,
          midY: pos.midY - scrollDelta,
        });
      });

      // Add group header positions so gaps between adjacent groups are valid targets
      groupHeaders.forEach((gh, gid) => {
        const headerTop = gh.top - scrollDelta;
        const headerBottom = gh.bottom - scrollDelta;
        visualItems.push({
          key: `__group__${gid}`,
          top: headerTop,
          bottom: headerBottom,
          midY: (headerTop + headerBottom) / 2,
        });
      });

      visualItems.sort((a, b) => a.top - b.top);

      /** Map a visual item to its displayOrder index.
       *  All card keys live in displayOrder so this is a direct lookup.
       *  Group header sentinels map to the group ID's index. */
      function getDisplayIdx(item: VisualItem): number {
        if (item.key.startsWith("__group__")) {
          const gid = item.key.slice(9);
          const idx = disp.indexOf(gid);
          return idx === -1 ? disp.length : idx;
        }
        const idx = disp.indexOf(item.key);
        return idx === -1 ? disp.length : idx;
      }

      // Range-based target computation using combined visual items
      let targetDisplayIdx = ds.sourceIdx;

      const sourcePos = positions.get(ds.sourceKey);
      const insideSource =
        sourcePos &&
        e.clientY >= sourcePos.top - scrollDelta &&
        e.clientY <= sourcePos.top + sourcePos.height - scrollDelta;

      if (!insideSource && visualItems.length > 0) {
        const first = visualItems[0];
        const last = visualItems[visualItems.length - 1];

        if (e.clientY <= first.top) {
          // Cursor above the first visual item
          let nearestAboveIdx = -1;
          let nearestAboveBottom = -Infinity;
          for (const vi of visualItems) {
            if (vi.bottom <= e.clientY && vi.bottom > nearestAboveBottom) {
              nearestAboveBottom = vi.bottom;
              const idx = getDisplayIdx(vi);
              if (idx !== -1 && idx > nearestAboveIdx) nearestAboveIdx = idx;
            }
          }
          targetDisplayIdx = nearestAboveIdx !== -1 ? nearestAboveIdx + 1 : 0;
        } else if (e.clientY >= last.bottom) {
          // Cursor below the last visual item
          let nearestBelowIdx = disp.length;
          let nearestBelowTop = Infinity;
          for (const vi of visualItems) {
            if (vi.top >= e.clientY && vi.top < nearestBelowTop) {
              nearestBelowTop = vi.top;
              const idx = getDisplayIdx(vi);
              if (idx !== -1 && idx < nearestBelowIdx) nearestBelowIdx = idx;
            }
          }
          targetDisplayIdx = nearestBelowIdx < disp.length ? nearestBelowIdx : disp.length;
        } else {
          // Cursor between visual items — find the gap
          let found = false;
          for (let i = 0; i < visualItems.length && !found; i++) {
            const vi = visualItems[i];

            if (e.clientY >= vi.top && e.clientY <= vi.bottom) {
              // Cursor is directly over this item.
              if (vi.key.startsWith("__group__")) {
                const gid = vi.key.slice(9);
                const slotZoneBottom = vi.top + (vi.bottom - vi.top) * 0.4;
                if (e.clientY < slotZoneBottom) {
                  // Top 40% of any header: slot before group (or exit if in this group)
                  targetDisplayIdx = getDisplayIdx(vi);
                } else if (gid === sourceGroupId) {
                  // Own group bottom 60%: reorder zone → blue line below header
                  targetDisplayIdx = getDisplayIdx(vi) + 1;
                } else {
                  // Other group bottom 60%: enter group → green highlight, no blue line
                  targetDisplayIdx = ds.sourceIdx;
                }
              } else {
                targetDisplayIdx =
                  e.clientY < vi.midY
                    ? getDisplayIdx(vi)
                    : getDisplayIdx(vi) + 1;
              }
              found = true;
            } else if (i < visualItems.length - 1) {
              const next = visualItems[i + 1];
              if (e.clientY > vi.bottom && e.clientY < next.top) {
                const gapMid = (vi.bottom + next.top) / 2;
                targetDisplayIdx =
                  e.clientY < gapMid
                    ? getDisplayIdx(vi) + 1
                    : getDisplayIdx(next);
                found = true;
              }
            }
          }
          if (!found) {
            targetDisplayIdx = ds.sourceIdx;
          }
        }
      } else if (visualItems.length === 0) {
        // No visual items at all — use source position
        const sp = positions.get(ds.sourceKey);
        if (sp) {
          const sourceBottom = sp.top + sp.height - scrollDelta;
          targetDisplayIdx = e.clientY > sourceBottom ? disp.length : ds.sourceIdx;
        }
      }

      // When the cursor is inside a different group's enter-zone (bottom 60%
      // of header or on group cards), suppress the blue insertion line.
      // The green highlight on the group header already signals "will enter
      // this group on mouseup". Intra-group reorder (same group) still shows
      // the blue line for card positioning.
      const targetGroupId = dragOverGroupRef.current;
      if (targetGroupId && targetGroupId !== sourceGroupId) {
        targetDisplayIdx = ds.sourceIdx;
      }

      if (targetDisplayIdx === -1) {
        log.info(`[drag] mousemove: targetDisplayIdx -1`);
        return;
      }

      if (!ds.started || targetDisplayIdx !== ds.currentIdx) {
        log.info(
          `[drag] mousemove targetDisplayIdx=${targetDisplayIdx} ` +
          `overGroup=${(dragOverGroupRef.current ?? "").slice(0, 8) || "null"} ` +
          `visualItems=${visualItems.length}`,
        );
      }

      setDragState((prev) =>
        prev
          ? {
              ...prev,
              started: true,
              currentIdx: targetDisplayIdx !== prev.currentIdx ? targetDisplayIdx : prev.currentIdx,
            }
          : null,
      );
    };

    // ── Mouseup handler ──
    const handleMouseUp = () => {
      const ds = dragStateRef.current;
      const targetGroupId = dragOverGroupRef.current;
      const sourceGroupId = ds ? (modGroupMapRef.current.get(ds.sourceKey) ?? null) : null;
      log.info(`[drag] mouseup sourceKey=${ds?.sourceKey} started=${ds?.started} sourceIdx=${ds?.sourceIdx} currentIdx=${ds?.currentIdx} dragOverGroup=${targetGroupId?.slice(0, 8) ?? "null"} sourceGroup=${sourceGroupId?.slice(0, 8) ?? "null"} multiDrag=${ds?.multiDrag}`);
      setDragState(null);

      if (ds?.started) {
        setTimeout(() => { refs.preventClickRef.current = false; }, 0);

        // Determine the keys being moved
        const isMulti = ds.multiDrag && ds.multiDragKeys && ds.multiDragKeys.length > 1;
        const movedKeys = isMulti ? ds.multiDragKeys! : [ds.sourceKey];
        const sourceIdx = isMulti ? (ds.multiDragMinIdx ?? ds.sourceIdx) : ds.sourceIdx;

        // Reposition in displayOrder (works for all keys — grouped or ungrouped)
        const order = displayOrderRef.current;
        const effectiveTargetIdx = ds.sourceIdx !== ds.currentIdx ? ds.currentIdx : null;
        const nextOrder = effectiveTargetIdx !== null
          ? moveKeysInDisplayOrder(order, movedKeys, sourceIdx, effectiveTargetIdx)
          : null;
        if (nextOrder) {
          setDisplayOrder(nextOrder);
        }

        // Group membership changes only (keys stay in displayOrder either way)
        if (targetGroupId && targetGroupId !== sourceGroupId) {
          // Enter different group
          for (const k of movedKeys) {
            handleMoveToGroup(k, targetGroupId);
          }
        } else if (sourceGroupId && !targetGroupId) {
          // Exit group
          for (const k of movedKeys) {
            handleMoveToGroup(k, null);
          }
        }
        // (staying in same group: no membership change needed — moveKeysInDisplayOrder
        //  already handled the intra-group reorder via displayOrder position)

        // Clear multi-selection after drag
        if (isMulti) {
          (controlledClear ?? (() => useModStore.getState().clearSelection()))();
        }

        dragOverGroupRef.current = null;
        setDragOverGroupId(null);
        setLineIndented(false);
      } else {
        refs.preventClickRef.current = false;
        setDragOverGroupId(null);
        setLineIndented(false);
      }
    };

    // Attach/detach listeners
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragState]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    dragState,
    dragOverGroupId,
    lineIndented,
    handleDragMouseDown,
  };
}
