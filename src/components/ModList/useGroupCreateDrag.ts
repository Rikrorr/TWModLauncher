import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModGroup } from "../../lib/types";
import { createLogger } from "../../lib/logger";
import { useModStore } from "../../store/useModStore";
import {
  snapshotDragPositions,
  DRAG_THRESHOLD,
  type DragRefs,
  type GroupCreateDragState,
} from "./utils";

const log = createLogger("useGroupCreateDrag");

interface UseGroupCreateDragParams {
  setGroups: React.Dispatch<React.SetStateAction<ModGroup[]>>;
  setDisplayOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setEditingGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  modGroupMapRef: React.MutableRefObject<Map<string, string>>;
  groups: ModGroup[];
  refs: DragRefs;
  /** ★ controlled: clear-selection source (defaults to global mod store). */
  clearSelection?: () => void;
}

export function useGroupCreateDrag({
  setGroups,
  setDisplayOrder,
  setEditingGroupId,
  modGroupMapRef,
  groups,
  refs,
  clearSelection: clearSelectionFn,
}: UseGroupCreateDragParams) {
  const [state, setState] = useState<GroupCreateDragState | null>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Clear multi-selection when dragging to create a new group
      (clearSelectionFn ?? (() => useModStore.getState().clearSelection()))();
      snapshotDragPositions(refs, groups);
      setState({
        active: false,
        startY: e.clientY,
        insertAfter: null,
        insertBefore: null,
      });
    },
    [refs, groups, clearSelectionFn],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const gc = stateRef.current;
      if (!gc) return;

      const dy = Math.abs(e.clientY - gc.startY);
      if (!gc.active && dy < DRAG_THRESHOLD) return;

      const container = refs.scrollContainerRef.current;
      const scrollDelta = container ? container.scrollTop - refs.scrollSnapshotRef.current : 0;

      const positions = refs.cardPositionsRef.current;
      const gHeaders = refs.groupHeaderPositionsRef.current;
      const currentGroupMap = modGroupMapRef.current;

      // Build combined visual items: ungrouped cards + group headers.
      // Group headers are included so gaps between adjacent collapsed/empty
      // groups are valid insertion points.
      interface VisualItem {
        key: string;
        top: number;
        bottom: number;
        midY: number;
      }

      const visualItems: VisualItem[] = [];

      // Ungrouped card positions
      positions.forEach((pos, k) => {
        if (currentGroupMap.has(k)) return;
        visualItems.push({
          key: k,
          top: pos.top - scrollDelta,
          bottom: pos.top + pos.height - scrollDelta,
          midY: pos.midY - scrollDelta,
        });
      });

      // Group header positions
      gHeaders.forEach((gh, gid) => {
        const headerTop = gh.top - scrollDelta;
        const headerBottom = gh.bottom - scrollDelta;
        visualItems.push({
          key: gid,
          top: headerTop,
          bottom: headerBottom,
          midY: (headerTop + headerBottom) / 2,
        });
      });

      visualItems.sort((a, b) => a.top - b.top);

      let insertAfter: string | null = null;
      let insertBefore: string | null = null;

      if (visualItems.length > 0) {
        const first = visualItems[0];
        const last = visualItems[visualItems.length - 1];

        if (e.clientY < first.midY) {
          insertBefore = first.key;
        } else if (e.clientY >= last.midY) {
          insertAfter = last.key;
        } else {
          for (let i = 0; i < visualItems.length - 1; i++) {
            const curr = visualItems[i];
            const next = visualItems[i + 1];
            if (e.clientY >= curr.midY && e.clientY < next.midY) {
              const gapMid = (curr.bottom + next.top) / 2;
              if (e.clientY < gapMid) {
                insertAfter = curr.key;
              } else {
                insertBefore = next.key;
              }
              break;
            }
          }
        }
      }

      const changed =
        !gc.active ||
        gc.insertAfter !== insertAfter ||
        gc.insertBefore !== insertBefore;

      if (changed) {
        log.info(`[group-create] mousemove insertAfter=${insertAfter ?? "null"} insertBefore=${insertBefore ?? "null"} active=${gc.active}`);
        setState({
          active: true,
          startY: gc.startY,
          insertAfter,
          insertBefore,
        });
      }
    };

    const handleMouseUp = () => {
      const gc = stateRef.current;
      if (!gc) return;
      log.info(`[group-create] mouseup active=${gc.active} insertAfter=${gc.insertAfter ?? "null"} insertBefore=${gc.insertBefore ?? "null"}`);

      const newGroup: ModGroup = {
        id: crypto.randomUUID(),
        name: "新建分组",
        collapsed: false,
        modKeys: [],
      };

      setState(null);
      setGroups((prev) => [...prev, newGroup]);

      // Insert group ID into unified displayOrder at the correct position
      if (gc.active && gc.insertBefore) {
        setDisplayOrder((prev) => {
          const idx = prev.indexOf(gc.insertBefore!);
          const next = [...prev];
          next.splice(idx === -1 ? prev.length : idx, 0, newGroup.id);
          return next;
        });
      } else if (gc.active && gc.insertAfter) {
        setDisplayOrder((prev) => {
          const idx = prev.indexOf(gc.insertAfter!);
          const next = [...prev];
          next.splice(idx === -1 ? prev.length : idx + 1, 0, newGroup.id);
          return next;
        });
      } else {
        setDisplayOrder((prev) => [...prev, newGroup.id]);
      }

      setTimeout(() => setEditingGroupId(newGroup.id), 0);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [setGroups, setDisplayOrder]);

  return {
    groupCreateState: state,
    handleGroupCreateMouseDown: handleMouseDown,
  };
}
