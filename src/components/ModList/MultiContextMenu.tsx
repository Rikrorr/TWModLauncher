import { useState, useRef, useEffect } from "react";
import type { ModGroup } from "../../lib/types";
import ContextMenu from "./ContextMenu";

interface Props {
  x: number;
  y: number;
  modCount: number;
  toggleLabel: string;
  onClose: () => void;
  onToggleAll: () => void;
  onSendToGroup: (groupId: string) => void;
  onOrderUp: () => void;
  onOrderDown: () => void;
  groups: ModGroup[];
  /** ★ v2: save the selection as an offline collection */
  onSaveAsCollection: () => void;
  /** ★ v2.1: remove the selection from the hosting scheme/collection */
  onRemoveFromContainer?: () => void;
  /** ★ v2.1: label for the remove item ("移出方案" / "移出集合") */
  removeLabel?: string;
}

function MenuItem({
  onClick,
  children,
  arrow,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  arrow?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700/70 transition-colors flex items-center gap-2 ${
        danger ? "text-red-400 hover:text-red-300" : "text-slate-200"
      }`}
    >
      <span className="flex-1">{children}</span>
      {arrow && <span className="text-slate-500 text-xs">{"\u25B8"}</span>}
    </button>
  );
}

function MenuSeparator() {
  return <div className="my-1 border-t border-slate-700" />;
}

export default function MultiContextMenu({
  x,
  y,
  modCount,
  toggleLabel,
  onClose,
  onToggleAll,
  onSendToGroup,
  onOrderUp,
  onOrderDown,
  groups,
  onSaveAsCollection,
  onRemoveFromContainer,
  removeLabel,
}: Props) {
  const [sendToOpen, setSendToOpen] = useState(false);
  const sendToRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  // Close submenu when mouse leaves both the trigger and the submenu
  useEffect(() => {
    if (!sendToOpen) return;
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as Node;
      const overTrigger = sendToRef.current?.contains(target);
      const overSubmenu = submenuRef.current?.contains(target);
      if (!overTrigger && !overSubmenu) {
        setSendToOpen(false);
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [sendToOpen]);

  // Determine submenu flip direction
  const [submenuFlip, setSubmenuFlip] = useState(false);
  useEffect(() => {
    if (sendToOpen && sendToRef.current) {
      const triggerRect = sendToRef.current.getBoundingClientRect();
      const estimatedRight = triggerRect.right + 160;
      if (estimatedRight > window.innerWidth) setSubmenuFlip(true);
    }
  }, [sendToOpen]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-700 mb-1">
        已选 {modCount} 个 Mod
      </div>

      {/* Toggle enable/disable all */}
      <MenuItem onClick={() => handleAction(onToggleAll)}>
        {toggleLabel}
      </MenuItem>

      <MenuSeparator />

      {/* Send to submenu */}
      <div
        ref={sendToRef}
        className="relative"
        onMouseEnter={() => groups.length > 0 && setSendToOpen(true)}
      >
        <button
          disabled={groups.length === 0}
          className={`w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2 ${
            groups.length === 0
              ? "text-slate-600 cursor-not-allowed"
              : "text-slate-200 hover:bg-slate-700/70"
          }`}
        >
          <span className="flex-1">发送到</span>
          <span className="text-slate-500 text-xs">{"\u25B8"}</span>
        </button>

        {sendToOpen && (
          <div
            ref={submenuRef}
            className={`absolute top-0 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px] z-[10000] ${
              submenuFlip ? "right-full" : "left-full"
            }`}
          >
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => handleAction(() => onSendToGroup(g.id))}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/70 transition-colors truncate"
              >
                {g.name || "未命名分组"}
              </button>
            ))}
          </div>
        )}
      </div>

      <MenuSeparator />

      {/* Order */}
      <MenuItem onClick={() => handleAction(onOrderUp)}>
        上移
      </MenuItem>
      <MenuItem onClick={() => handleAction(onOrderDown)}>
        下移
      </MenuItem>

      <MenuSeparator />

      {/* ★ v2: save selection as collection */}
      <MenuItem onClick={() => handleAction(onSaveAsCollection)}>
        保存为集合…
      </MenuItem>

      {/* ★ v2.1: remove from hosting scheme/collection */}
      {onRemoveFromContainer && removeLabel && (
        <>
          <MenuSeparator />
          <MenuItem onClick={() => handleAction(onRemoveFromContainer)} danger>
            {removeLabel}
          </MenuItem>
        </>
      )}
    </ContextMenu>
  );
}
