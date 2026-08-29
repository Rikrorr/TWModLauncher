import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModGroup } from "../../lib/types";
import { createLogger } from "../../lib/logger";
import { useModStore } from "../../store/useModStore";
import {
  autoScroll,
  snapshotDragPositions,
  DRAG_THRESHOLD,
  type DragRefs,
  type GroupHeaderDragState,
} from "./utils";

const log = createLogger("useGroupHeaderDrag");

interface UseGroupHeaderDragParams {
  displayOrder: string[];
  setDisplayOrder: React.Dispatch<React.SetStateAction<string[]>>;
  groups: ModGroup[];
  refs: DragRefs;
  /** ★ controlled: clear-selection source (defaults to global mod store). */
  clearSelection?: () => void;
}

export function useGroupHeaderDrag({
  displayOrder,
  setDisplayOrder,
  groups,
  refs,
  clearSelection: clearSelectionFn,
}: UseGroupHeaderDragParams) {
  const [state, setState] = useState<GroupHeaderDragState | null>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; });

  const groupHeaderHeightRef = useRef(42);
  const groupDragSlotHeightRef = useRef(42);

  const displayOrderRef = useRef(displayOrder);
  useLayoutEffect(() => { displayOrderRef.current = displayOrder; });

  const handleMouseDown = useCallback(
    // eslint-disable-next-line react-hooks/immutability -- refs mutation in event handler is intended drag pattern
    (e: React.MouseEvent, groupId: string) => {
      const idx = displayOrder.indexOf(groupId);
      if (idx === -1) return;
      e.preventDefault();
      // eslint-disable-next-line react-hooks/immutability
      refs.preventClickRef.current = true;

      // Clear multi-selection when dragging a group header
      (clearSelectionFn ?? (() => useModStore.getState().clearSelection()))();

      // Snapshot all DOM positions
      snapshotDragPositions(refs, groups, {
        draggedGroupId: groupId,
        groupHeaderHeightRef,
        groupDragSlotHeightRef,
      });

      setState({
        sourceGroupId: groupId,
        sourceIdx: idx,
        currentIdx: idx,
        startY: e.clientY,
        started: false,
      });
    },
    [displayOrder, groups, refs],
  );

  // Event listener lifecycle
  useEffect(() => {
    if (!state) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ds = stateRef.current;
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

      // Find closest group header + card
      const groupHeaders = refs.groupHeaderPositionsRef.current;
      const cardPositions = refs.cardPositionsRef.current;
      const order = displayOrderRef.current;

      const ownGroup = groups.find((g) => g.id === ds.sourceGroupId);
      const ownModKeys = new Set(ownGroup?.modKeys ?? []);

      // Closest group header (excluding self)
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

      // Closest card (excluding own group's cards)
      let closestCardKey: string | null = null;
      let closestCardDist = Infinity;
      cardPositions.forEach((pos, k) => {
        if (ownModKeys.has(k)) return;
        const midY = pos.midY - scrollDelta;
        const dist = Math.abs(e.clientY - midY);
        if (dist < closestCardDist) {
          closestCardDist = dist;
          closestCardKey = k;
        }
      });

      if (!ds.started) {
        setState((prev) => (prev ? { ...prev, started: true } : null));
      }

      // Choose group vs card target
      const useGroupTarget = closestGid && closestGidDist <= closestCardDist;

      // Suppress slot while cursor is still inside the source group header bounds
      const sourceGh = groupHeaders.get(ds.sourceGroupId);
      const withinSource =
        sourceGh &&
        e.clientY >= sourceGh.top - scrollDelta &&
        e.clientY <= sourceGh.bottom - scrollDelta;

      if (useGroupTarget) {
        let targetIdx = order.indexOf(closestGid!);
        if (targetIdx === -1) return;

        if (!withinSource) {
          const closestGh = groupHeaders.get(closestGid!);
          if (closestGh) {
            const midY = (closestGh.top + closestGh.bottom) / 2 - scrollDelta;
            if (e.clientY > midY) targetIdx += 1;
          }
        }

        setState((prev) =>
          prev
            ? {
                ...prev,
                currentIdx: targetIdx !== prev.currentIdx ? targetIdx : prev.currentIdx,
              }
            : null,
        );
      } else if (closestCardKey && !withinSource) {
        // Find the displayOrder index for this card
        const cardIdx = order.indexOf(closestCardKey);
        if (cardIdx !== -1) {
          const cardPos = cardPositions.get(closestCardKey);
          const above = cardPos ? e.clientY < cardPos.midY - scrollDelta : false;
          const targetIdx = above ? cardIdx : cardIdx + 1;

          setState((prev) =>
            prev
              ? {
                  ...prev,
                  currentIdx: targetIdx !== prev.currentIdx ? targetIdx : prev.currentIdx,
                  slotBeforeKey: above ? closestCardKey! : undefined,
                }
              : null,
          );
        }
      }
    };

    // Mouseup handler
    const handleMouseUp = () => {
      const ds = stateRef.current;
      log.debug(`[group-drag] mouseup sourceGroupId=${ds?.sourceGroupId} started=${ds?.started} sourceIdx=${ds?.sourceIdx} currentIdx=${ds?.currentIdx} slotBeforeKey=${ds?.slotBeforeKey ?? "undefined"}`);
      setState(null);

      if (ds?.started) {
        setTimeout(() => { refs.preventClickRef.current = false; }, 0);

        if (ds.sourceIdx !== ds.currentIdx) {
          // Move group ID in unified displayOrder
          setDisplayOrder((prev) => {
            const next = [...prev];
            const [item] = next.splice(ds.sourceIdx, 1);
            // Adjust target if removing shifted indices
            let target = ds.currentIdx;
            if (ds.currentIdx > ds.sourceIdx) target -= 1;
            next.splice(target, 0, item);
            return next;
          });
        }
      } else {
        refs.preventClickRef.current = false;
      }
    };

    // Attach/detach listeners
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    groupHeaderDragState: state,
    handleGroupHeaderDragMouseDown: handleMouseDown,
  };
}
