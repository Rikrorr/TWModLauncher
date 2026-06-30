import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModGroup } from "../../lib/types";
import { createLogger } from "../../lib/logger";
import {
  autoScroll,
  snapshotDragPositions,
  DRAG_THRESHOLD,
  type DragRefs,
  type GroupHeaderDragState,
} from "./utils";

const log = createLogger("useGroupHeaderDrag");

interface UseGroupHeaderDragParams {
  groupOrder: string[];
  setGroupOrder: React.Dispatch<React.SetStateAction<string[]>>;
  groups: ModGroup[];
  setGroups: React.Dispatch<React.SetStateAction<ModGroup[]>>;
  setDisplayOrder: React.Dispatch<React.SetStateAction<string[]>>;
  refs: DragRefs;
}

export function useGroupHeaderDrag({
  groupOrder,
  setGroupOrder,
  groups,
  setGroups,
  setDisplayOrder,
  refs,
}: UseGroupHeaderDragParams) {
  const [state, setState] = useState<GroupHeaderDragState | null>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; });

  const groupHeaderHeightRef = useRef(42);
  const groupDragSlotHeightRef = useRef(42);

  const groupOrderRef = useRef(groupOrder);
  useLayoutEffect(() => { groupOrderRef.current = groupOrder; });

  const handleMouseDown = useCallback(
    // eslint-disable-next-line react-hooks/immutability -- refs mutation in event handler is intended drag pattern
    (e: React.MouseEvent, groupId: string) => {
      const idx = groupOrder.indexOf(groupId);
      if (idx === -1) return;
      e.preventDefault();
      // eslint-disable-next-line react-hooks/immutability
      refs.preventClickRef.current = true;

      // ── shared: snapshot all DOM positions ──
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
    [groupOrder, groups, refs],
  );

  // ── shared: event listener lifecycle ──
  useEffect(() => {
    if (!state) return;

    const handleMouseMove = (e: MouseEvent) => {
      const ds = stateRef.current;
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

      // ── group-specific: find closest group header + card ──
      const groupHeaders = refs.groupHeaderPositionsRef.current;
      const cardPositions = refs.cardPositionsRef.current;
      const go = groupOrderRef.current;

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
      let closestCardAbove = false;
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

      if (!ds.started) {
        setState((prev) => (prev ? { ...prev, started: true } : null));
      }

      // ── group-specific: choose group vs card target ──
      const useGroupTarget = closestGid && closestGidDist <= closestCardDist;
      const useCardTarget = closestCardKey && (!closestGid || closestCardDist < closestGidDist);

      // Suppress slot while cursor is still inside the source group header bounds.
      const sourceGh = groupHeaders.get(ds.sourceGroupId);
      const withinSource =
        sourceGh &&
        e.clientY >= sourceGh.top - scrollDelta &&
        e.clientY <= sourceGh.bottom - scrollDelta;

      if (useGroupTarget) {
        let targetIdx = go.indexOf(closestGid!);
        if (targetIdx === -1) return;

        if (!withinSource) {
          const closestGh = groupHeaders.get(closestGid!);
          if (closestGh) {
            const midY = (closestGh.top + closestGh.bottom) / 2 - scrollDelta;
            if (e.clientY > midY) targetIdx += 1;
          }
        }

        if (targetIdx !== ds.currentIdx || ds.slotBeforeKey) {
          log.debug(`[group-drag] mousemove closestGid=${closestGid} targetIdx=${targetIdx}`);
        }

        setState((prev) =>
          prev
            ? {
                ...prev,
                currentIdx: targetIdx !== prev.currentIdx ? targetIdx : prev.currentIdx,
                slotBeforeKey: undefined,
              }
            : null,
        );
      } else if (useCardTarget) {
        if (withinSource) {
          if (ds.slotBeforeKey) {
            setState((prev) => (prev ? { ...prev, slotBeforeKey: undefined } : null));
          }
        } else {
          const changed = ds.slotBeforeKey !== closestCardKey || ds.insertAfter !== !closestCardAbove;
          if (changed) {
            log.debug(`[group-drag] mousemove cardTarget=${closestCardKey} above=${closestCardAbove}`);
          }
          setState((prev) =>
            prev
              ? {
                  ...prev,
                  slotBeforeKey: changed ? closestCardKey! : prev.slotBeforeKey,
                  insertAfter: changed ? !closestCardAbove : prev.insertAfter,
                }
              : null,
          );
        }
      }
    };

    // ── group-specific: mouseup handler ──
    const handleMouseUp = () => {
      const ds = stateRef.current;
      log.debug(`[group-drag] mouseup sourceGroupId=${ds?.sourceGroupId} started=${ds?.started} sourceIdx=${ds?.sourceIdx} currentIdx=${ds?.currentIdx} slotBeforeKey=${ds?.slotBeforeKey}`);
      setState(null);

      if (ds?.started) {
        setTimeout(() => { refs.preventClickRef.current = false; }, 0);

        if (ds.slotBeforeKey) {
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
            log.debug(`[group-drag] mouseup set anchor for empty group`);
          }
        } else if (ds.sourceIdx !== ds.currentIdx) {
          setGroupOrder((prev) => {
            const next = [...prev];
            const [item] = next.splice(ds.sourceIdx, 1);
            next.splice(ds.currentIdx, 0, item);
            return next;
          });
        }
      } else {
        refs.preventClickRef.current = false;
      }
    };

    // ── shared: attach/detach listeners ──
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
