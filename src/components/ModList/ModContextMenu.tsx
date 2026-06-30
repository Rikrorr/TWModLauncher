import { useState, useRef, useEffect } from "react";
import type { ModInfo, ModGroup } from "../../lib/types";
import ContextMenu from "./ContextMenu";

interface Props {
  modKey: string;
  mod: ModInfo;
  x: number;
  y: number;
  groups: ModGroup[];
  currentGroupId: string | undefined;
  onClose: () => void;
  onToggle: (fileId: number, enabled: boolean) => void;
  onSendToGroup: (modKey: string, groupId: string) => void;
  onCreateGroupAndSend: (modKey: string) => void;
  onOrderUp: () => void;
  onOrderDown: () => void;
  onOpenInExplorer: () => void;
  onOpenWorkshop: () => void;
  onViewDetail: () => void;
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

export default function ModContextMenu({
  modKey,
  mod,
  x,
  y,
  groups,
  currentGroupId,
  onClose,
  onToggle,
  onSendToGroup,
  onCreateGroupAndSend,
  onOrderUp,
  onOrderDown,
  onOpenInExplorer,
  onOpenWorkshop,
  onViewDetail,
}: Props) {
  const [sendToOpen, setSendToOpen] = useState(false);
  const sendToRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  // Available groups for "send to" (exclude current group)
  const availableGroups = groups.filter((g) => g.id !== currentGroupId);

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
      {/* Toggle enable/disable */}
      <MenuItem onClick={() => handleAction(() => onToggle(mod.fileId, !mod.enabled))}>
        {mod.enabled ? "禁用" : "启用"}
      </MenuItem>

      <MenuSeparator />

      {/* Send to submenu */}
      <div
        ref={sendToRef}
        className="relative"
        onMouseEnter={() => setSendToOpen(true)}
      >
        <button
          className="w-full text-left px-3 py-1.5 text-sm hover:bg-slate-700/70 transition-colors flex items-center gap-2 text-slate-200"
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
            {availableGroups.length > 0 ? (
              availableGroups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => handleAction(() => onSendToGroup(modKey, g.id))}
                  className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/70 transition-colors truncate"
                >
                  {g.name}
                </button>
              ))
            ) : (
              <span className="block px-3 py-1.5 text-sm text-slate-500">
                无可用分组
              </span>
            )}

            <MenuSeparator />

            <button
              onClick={() => handleAction(() => onCreateGroupAndSend(modKey))}
              className="w-full text-left px-3 py-1.5 text-sm text-blue-400 hover:bg-slate-700/70 transition-colors"
            >
              + 新建分组...
            </button>
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

      {/* File system / workshop */}
      <MenuItem onClick={() => handleAction(onOpenInExplorer)}>
        打开所在文件夹
      </MenuItem>
      {mod.source === 1 && (
        <MenuItem onClick={() => handleAction(onOpenWorkshop)}>
          Steam Workshop 页面
        </MenuItem>
      )}

      <MenuSeparator />

      {/* View detail */}
      <MenuItem onClick={() => handleAction(onViewDetail)}>
        查看详情
      </MenuItem>
    </ContextMenu>
  );
}
