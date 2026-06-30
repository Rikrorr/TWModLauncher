import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ModGroup } from "../../lib/types";
import { createLogger } from "../../lib/logger";
import {
  snapshotDragPositions,
  type DragRefs,
  type GroupCreateDragState,
} from "./utils";

const log = createLogger("useGroupCreateDrag");
const GROUP_DRAG_THRESHOLD = 5;

interface UseGroupCreateDragParams {
  setGroups: React.Dispatch<React.SetStateAction<ModGroup[]>>;
  setGroupOrder: React.Dispatch<React.SetStateAction<string[]>>;
  setEditingGroupId: React.Dispatch<React.SetStateAction<string | null>>;
  modGroupMapRef: React.MutableRefObject<Map<string, string>>;
  groupOrderRef: React.MutableRefObject<string[]>;
  groups: ModGroup[];
  refs: DragRefs;
}

export function useGroupCreateDrag({
  setGroups,
  setGroupOrder,
  setEditingGroupId,
  modGroupMapRef,
  groupOrderRef,
  groups,
  refs,
}: UseGroupCreateDragParams) {
  const [state, setState] = useState<GroupCreateDragState | null>(null);
  const stateRef = useRef(state);
  useLayoutEffect(() => { stateRef.current = state; });

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      snapshotDragPositions(refs, groups);
      setState({
        active: false,
        startY: e.clientY,
        slotY: e.clientY,
        insertAfter: null,
        insertBefore: null,
        groupOrderIdx: groupOrderRef.current.length,
      });
    },
    [refs, groups, groupOrderRef],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const gc = stateRef.current;
      if (!gc) return;

      const dy = Math.abs(e.clientY - gc.startY);
      if (!gc.active && dy < GROUP_DRAG_THRESHOLD) return;

      const container = refs.scrollContainerRef.current;
      const scrollDelta = container ? container.scrollTop - refs.scrollSnapshotRef.current : 0;

      const positions = refs.cardPositionsRef.current;
      const gHeaders = refs.groupHeaderPositionsRef.current;
      const currentGroupMap = modGroupMapRef.current;

      // Find closest UNGROUPED card
      let closestKey: string | null = null;
      let closestDist = Infinity;
      positions.forEach((pos, k) => {
        if (currentGroupMap.has(k)) return;
        const adjustedMidY = pos.midY - scrollDelta;
        const dist = Math.abs(e.clientY - adjustedMidY);
        if (dist < closestDist) {
          closestDist = dist;
          closestKey = k;
        }
      });

      let insertAfter: string | null = null;
      let slotY = e.clientY;
      if (closestKey) {
        const pos = positions.get(closestKey)!;
        const adjustedMidY = pos.midY - scrollDelta;
        const adjustedTop = pos.top - scrollDelta;
        const adjustedBottom = pos.top + pos.height - scrollDelta;
        const above = e.clientY < adjustedMidY;
        insertAfter = above ? null : closestKey;
        slotY = above ? adjustedTop : adjustedBottom;
      }

      let goIdx = groupOrderRef.current.length;
      for (let i = 0; i < groupOrderRef.current.length; i++) {
        const gid = groupOrderRef.current[i];
        const gh = gHeaders.get(gid);
        if (gh && e.clientY < gh.bottom - scrollDelta) {
          goIdx = i;
          break;
        }
      }

      const insertBefore = closestKey && !insertAfter ? closestKey : null;

      const changed =
        !gc.active ||
        gc.insertAfter !== insertAfter ||
        gc.insertBefore !== insertBefore ||
        gc.groupOrderIdx !== goIdx;

      if (changed) {
        log.debug(`[group-create] mousemove closestKey=${closestKey} insertAfter=${insertAfter} goIdx=${goIdx}`);
        setState({
          active: true,
          startY: gc.startY,
          slotY,
          insertAfter,
          insertBefore,
          groupOrderIdx: goIdx,
        });
      }
    };

    const handleMouseUp = () => {
      const gc = stateRef.current;
      if (!gc) return;
      log.debug(`[group-create] mouseup active=${gc.active} insertAfter=${gc.insertAfter}`);

      const newGroup: ModGroup = {
        id: crypto.randomUUID(),
        name: "新建分组",
        collapsed: false,
        modKeys: [],
        anchorBefore: gc.insertBefore ?? undefined,
        anchorAfter: gc.insertAfter ?? undefined,
      };

      setState(null);
      setGroups((prev) => [...prev, newGroup]);

      if (gc.active) {
        setGroupOrder((prev) => {
          const next = [...prev];
          next.splice(gc.groupOrderIdx, 0, newGroup.id);
          return next;
        });
      } else {
        setGroupOrder((prev) => [newGroup.id, ...prev]);
      }

      setTimeout(() => setEditingGroupId(newGroup.id), 0);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- always mounted, lightweight early return when state is null

  return {
    groupCreateState: state,
    handleGroupCreateMouseDown: handleMouseDown,
  };
}
