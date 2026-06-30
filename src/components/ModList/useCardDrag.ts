import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModGroup } from "../../lib/types";
import { createLogger } from "../../lib/logger";
import {
  autoScroll,
  snapshotDragPositions,
  DRAG_THRESHOLD,
  type CardDragState,
  type DragRefs,
} from "./utils";

const log = createLogger("useCardDrag");

interface UseCardDragParams {
  displayOrder: string[];
  setDisplayOrder: React.Dispatch<React.SetStateAction<string[]>>;
  groups: ModGroup[];
  modGroupMapRef: React.MutableRefObject<Map<string, string>>;
  groupOrderRef: React.MutableRefObject<string[]>;
  handleMoveToGroup: (modKey: string, groupId: string | null, displayOrder?: string[]) => void;
  refs: DragRefs;
}

export function useCardDrag({
  displayOrder,
  setDisplayOrder,
  groups,
  modGroupMapRef,
  groupOrderRef,
  handleMoveToGroup,
  refs,
}: UseCardDragParams) {
  const [dragState, setDragState] = useState<CardDragState | null>(null);
  const dragStateRef = useRef(dragState);
  useLayoutEffect(() => { dragStateRef.current = dragState; });

  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const dragOverGroupRef = useRef<string | null>(null);

  const displayOrderRef = useRef(displayOrder);
  useLayoutEffect(() => { displayOrderRef.current = displayOrder; });

  const handleDragMouseDown = useCallback(
    // eslint-disable-next-line react-hooks/immutability -- refs mutation in event handler is intended drag pattern
    (e: React.MouseEvent, key: string) => {
      const idx = displayOrder.indexOf(key);
      if (idx === -1) {
        log.debug(`[drag] mousedown skipped: key not in displayOrder ${key}`);
        return;
      }
      log.debug(`[drag] mousedown start key=${key} idx=${idx}`);
      e.preventDefault();
      // eslint-disable-next-line react-hooks/immutability
      refs.preventClickRef.current = true;

      // ── shared: snapshot all DOM positions ──
      snapshotDragPositions(refs, groups);

      setDragState({
        sourceKey: key,
        sourceIdx: idx,
        currentIdx: idx,
        startY: e.clientY,
        started: false,
        sourceGroupId: modGroupMapRef.current.get(key) ?? undefined,
      });
    },
    [displayOrder, groups, modGroupMapRef, refs],
  );

  // ── shared: event listener lifecycle ──
  useEffect(() => {
    if (!dragState) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;

      // ── shared: threshold check ──
      const dy = Math.abs(e.clientY - ds.startY);
      if (!ds.started && dy < DRAG_THRESHOLD) return;

      // ── shared: auto-scroll + scrollDelta ──
      const container = refs.scrollContainerRef.current;
      autoScroll(e, container, refs);
      const scrollDelta = container
        ? container.scrollTop - refs.scrollSnapshotRef.current
        : 0;

      // ── card-specific: detect which group the cursor is in (header + cards).
      //     Must run before target building so grouped cards are included. ──
      const groupHeaders = refs.groupHeaderPositionsRef.current;
      const positions = refs.cardPositionsRef.current;

      dragOverGroupRef.current = null;
      groupHeaders.forEach((gh, gid) => {
        const groupTop = gh.top - scrollDelta;
        let groupBottom = gh.bottom - scrollDelta;
        // Extend to the full visual area of the group (header + all cards)
        for (const [k, pos] of positions) {
          const cardGid = modGroupMapRef.current.get(k) ?? null;
          if (cardGid === gid) {
            const b = pos.top + pos.height - scrollDelta;
            if (b > groupBottom) groupBottom = b;
          }
        }
        if (e.clientY >= groupTop && e.clientY <= groupBottom) {
          dragOverGroupRef.current = gid;
        }
      });
      const hoveringOverGroup = dragOverGroupRef.current;
      setDragOverGroupId(hoveringOverGroup);

      // ── card-specific: collect valid target cards sorted by visual position ──
      const currentGroupMap = modGroupMapRef.current;
      const draggedGroupId = currentGroupMap.get(ds.sourceKey) ?? null;

      const targets: { key: string; top: number; bottom: number; midY: number }[] = [];
      positions.forEach((pos, k) => {
        if (k === ds.sourceKey) return;
        const gid = currentGroupMap.get(k) ?? null;
        if (draggedGroupId) {
          // Grouped card: include cards in the same group + ungrouped cards
          if (gid !== draggedGroupId && gid !== null) return;
        } else if (hoveringOverGroup) {
          // Ungrouped card hovering over a group: include that group's cards
          // + ungrouped cards, so the insertion position is meaningful
          if (gid !== null && gid !== hoveringOverGroup) return;
        } else {
          // Ungrouped card not over any group: only ungrouped cards
          if (gid !== null) return;
        }
        targets.push({
          key: k,
          top: pos.top - scrollDelta,
          bottom: pos.top + pos.height - scrollDelta,
          midY: pos.midY - scrollDelta,
        });
      });
      targets.sort((a, b) => a.top - b.top);

      const disp = displayOrderRef.current;

      let slotBeforeGroupId: string | undefined;

      if (!hoveringOverGroup && !draggedGroupId) {
        const go = groupOrderRef.current;
        const gHeaders = refs.groupHeaderPositionsRef.current;
        for (let i = 0; i < go.length; i++) {
          const gh = gHeaders.get(go[i]);
          if (!gh) continue;
          if (e.clientY < gh.top - scrollDelta) {
            slotBeforeGroupId = go[i];
            break;
          }
        }
      }

      // ── Range-based target computation ──
      // Compute the insertion position based on cursor position relative to
      // card bounds and inter-card gaps. Runs for all drag scenarios.
      let targetDisplayIdx = ds.sourceIdx;
      let cursorOverCardKey: string | null = null;

      const sourcePos = positions.get(ds.sourceKey);
      const insideSource =
        sourcePos &&
        e.clientY >= sourcePos.top - scrollDelta &&
        e.clientY <= sourcePos.top + sourcePos.height - scrollDelta;

      if (!insideSource && targets.length > 0) {
        const first = targets[0];
        const last = targets[targets.length - 1];

        if (e.clientY <= first.top) {
          targetDisplayIdx = disp.indexOf(first.key);
        } else if (e.clientY >= last.bottom) {
          targetDisplayIdx = disp.indexOf(last.key) + 1;
        } else {
          let found = false;
          for (let i = 0; i < targets.length && !found; i++) {
            const t = targets[i];

            if (e.clientY >= t.top && e.clientY <= t.bottom) {
              cursorOverCardKey = t.key;
              targetDisplayIdx =
                e.clientY < t.midY
                  ? disp.indexOf(t.key)
                  : disp.indexOf(t.key) + 1;
              found = true;
            } else if (i < targets.length - 1) {
              const next = targets[i + 1];
              if (e.clientY > t.bottom && e.clientY < next.top) {
                const gapMid = (t.bottom + next.top) / 2;
                targetDisplayIdx =
                  e.clientY < gapMid
                    ? disp.indexOf(t.key) + 1
                    : disp.indexOf(next.key);
                found = true;
              }
            }
          }
          if (!found) {
            targetDisplayIdx = ds.sourceIdx;
          }
        }
      } else if (targets.length === 0) {
        targetDisplayIdx = draggedGroupId ? ds.currentIdx : 0;
      }

      // Suppress no-op: inserting right after source is equivalent to staying
      // in place — after splice removal the adjusted index is sourceIdx.
      if (targetDisplayIdx === ds.sourceIdx + 1) {
        targetDisplayIdx = ds.sourceIdx;
      }

      // ── Group boundary detection ──
      // Determine if a grouped card is exiting its source group.
      // Exit when: (a) cursor is over a non-group-member card, or
      // (b) targetDisplayIdx falls outside the group's member range.
      let exitingGroup: 'top' | 'bottom' | undefined;

      if (draggedGroupId && !hoveringOverGroup) {
        const ownGroup = groups.find((g) => g.id === draggedGroupId);
        if (ownGroup && ownGroup.modKeys.length > 0) {
          let minIdx = disp.length;
          let maxIdx = -1;
          for (const mk of ownGroup.modKeys) {
            const idx = disp.indexOf(mk);
            if (idx !== -1) {
              if (idx < minIdx) minIdx = idx;
              if (idx > maxIdx) maxIdx = idx;
            }
          }

          // Rule A: cursor directly over a non-group card → always exit.
          // Keep the range-based targetDisplayIdx — it already points to the
          // cursor position. Only set the exit direction.
          if (cursorOverCardKey) {
            const cardGid = currentGroupMap.get(cursorOverCardKey) ?? null;
            if (cardGid !== draggedGroupId) {
              exitingGroup =
                disp.indexOf(cursorOverCardKey) <= minIdx ? 'top' : 'bottom';
            }
          }

          // Rule B: target position is outside the group's member range
          if (!exitingGroup) {
            const gh = refs.groupHeaderPositionsRef.current.get(draggedGroupId);
            if (gh && e.clientY < gh.top - scrollDelta) {
              exitingGroup = 'top';
            } else if (targetDisplayIdx < minIdx) {
              exitingGroup = 'top';
            } else if (targetDisplayIdx > maxIdx + 1) {
              exitingGroup = 'bottom';
            }
          }
        }
      }

      // Snap outside group boundaries
      if (!draggedGroupId && !hoveringOverGroup) {
        for (const gid of groupOrderRef.current) {
          const group = groups.find((g) => g.id === gid);
          if (!group || group.modKeys.length === 0) continue;
          let minIdx = Infinity;
          let maxIdx = -1;
          for (const mk of group.modKeys) {
            const idx = disp.indexOf(mk);
            if (idx !== -1) {
              if (idx < minIdx) minIdx = idx;
              if (idx > maxIdx) maxIdx = idx;
            }
          }
          if (targetDisplayIdx >= minIdx && targetDisplayIdx <= maxIdx) {
            targetDisplayIdx = minIdx;
            slotBeforeGroupId = gid;
            break;
          }
        }
      }

      if (targetDisplayIdx === -1) {
        log.debug(`[drag] mousemove: targetDisplayIdx -1`);
        return;
      }

      if (!ds.started || targetDisplayIdx !== ds.currentIdx || slotBeforeGroupId !== ds.slotBeforeGroupId) {
        log.debug(`[drag] mousemove targetDisplayIdx=${targetDisplayIdx} overGroup=${dragOverGroupRef.current} slotBeforeGroupId=${slotBeforeGroupId}`);
      }

      setDragState((prev) =>
        prev
          ? {
              ...prev,
              started: true,
              currentIdx: targetDisplayIdx !== prev.currentIdx ? targetDisplayIdx : prev.currentIdx,
              slotBeforeGroupId,
              exitingGroup,
            }
          : null,
      );
    };

    // ── card-specific: mouseup handler ──
    const handleMouseUp = () => {
      const ds = dragStateRef.current;
      const targetGroupId = dragOverGroupRef.current;
      log.debug(`[drag] mouseup sourceKey=${ds?.sourceKey} started=${ds?.started} sourceIdx=${ds?.sourceIdx} currentIdx=${ds?.currentIdx} dragOverGroup=${targetGroupId} slotBeforeGroupId=${ds?.slotBeforeGroupId}`);
      setDragState(null);

      if (ds?.started) {
        setTimeout(() => { refs.preventClickRef.current = false; }, 0);

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
          : ds.sourceIdx !== ds.currentIdx
            ? ds.currentIdx
            : null;

        // Skip reorder only for true cross-group moves (grouped card →
        // DIFFERENT group). Same-group reorder, exiting, and ungrouped→group
        // all need displayOrder to reflect the cursor position.
        const crossGroupMove = !!(targetGroupId && ds.sourceGroupId && targetGroupId !== ds.sourceGroupId);
        if (!crossGroupMove && effectiveTargetIdx !== null) {
          setDisplayOrder((prev) => {
            const next = [...prev];
            const [item] = next.splice(ds.sourceIdx, 1);
            const adjustedIdx = effectiveTargetIdx > ds.sourceIdx ? effectiveTargetIdx - 1 : effectiveTargetIdx;
            next.splice(adjustedIdx, 0, item);
            return next;
          });
        }

        if (targetGroupId && targetGroupId !== ds.sourceGroupId) {
          // Dropped onto a DIFFERENT group (or entering from ungrouped) →
          // move card to that group
          handleMoveToGroup(ds.sourceKey, targetGroupId, displayOrderRef.current);
        } else if (ds.exitingGroup) {
          // Cursor left the source group boundary → move card out of the group
          handleMoveToGroup(ds.sourceKey, null, displayOrderRef.current);
        }
        // else: within-group reorder — stay in group, only setDisplayOrder was called
        dragOverGroupRef.current = null;
        setDragOverGroupId(null);
      } else {
        refs.preventClickRef.current = false;
        setDragOverGroupId(null);
      }
    };

    // ── shared: attach/detach listeners ──
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
    handleDragMouseDown,
  };
}
