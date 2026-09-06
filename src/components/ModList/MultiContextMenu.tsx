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
  /** ★ v2.1: join into a scheme/collection (two-level) */
  schemes?: { name: string }[];
  collections?: { id: string; name: string }[];
  onAddToScheme?: (name: string) => void;
  onAddToCollection?: (id: string) => void;
  onCreateScheme?: () => void;
  onCreateCollection?: () => void;
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
  schemes,
  collections,
  onAddToScheme,
  onAddToCollection,
  onCreateScheme,
  onCreateCollection,
}: Props) {
  const [sendToOpen, setSendToOpen] = useState(false);
  const sendToRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  // ★ v2.1: join / new two-level submenus
  const hasJoin = !!onAddToScheme || !!onAddToCollection || !!onCreateScheme || !!onCreateCollection;
  const [joinOpen, setJoinOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const joinRef = useRef<HTMLDivElement>(null);
  const joinSubRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const newSubRef = useRef<HTMLDivElement>(null);
  const [subFlip, setSubFlip] = useState(false);

  // Close submenu when mouse leaves both the trigger and the submenu
  useEffect(() => {
    if (!sendToOpen && !joinOpen && !newOpen) return;
    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as Node;
      const overSend =
        sendToRef.current?.contains(target) || submenuRef.current?.contains(target);
      const overJoin =
        joinRef.current?.contains(target) || joinSubRef.current?.contains(target);
      const overNew =
        newRef.current?.contains(target) || newSubRef.current?.contains(target);
      if (!overSend && !overJoin && !overNew) {
        setSendToOpen(false);
        setJoinOpen(false);
        setNewOpen(false);
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    return () => document.removeEventListener("mousemove", handleMouseMove);
  }, [sendToOpen, joinOpen, newOpen]);

  // Determine submenu flip direction
  useEffect(() => {
    if ((sendToOpen || joinOpen || newOpen) && (sendToRef.current || joinRef.current || newRef.current)) {
      const anchor = sendToRef.current ?? joinRef.current ?? newRef.current;
      if (anchor) {
        const rect = anchor.getBoundingClientRect();
        if (rect.right + 170 > window.innerWidth) setSubFlip(true);
      }
    }
  }, [sendToOpen, joinOpen, newOpen]);

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

      {/* ★ v2.1: 加入 → 方案/集合, 新建 → 方案/集合 */}
      {hasJoin && (
        <>
          <div ref={joinRef} className="relative" onMouseEnter={() => { setJoinOpen(true); setNewOpen(false); }}>
            <MenuItem onClick={() => {}} arrow>加入</MenuItem>
            {joinOpen && (
              <div ref={joinSubRef} className={`absolute top-0 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px] z-[10000] ${subFlip ? "right-full" : "left-full"}`}>
                {onAddToScheme && (
                  <div className="px-3 py-1 text-[10px] text-slate-500">加入方案</div>
                )}
                {(schemes?.length ?? 0) > 0 ? (
                  schemes?.map((s) => (
                    <button key={s.name} onClick={() => handleAction(() => onAddToScheme!(s.name))}
                      className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/70 transition-colors truncate">
                      {s.name}
                    </button>
                  ))
                ) : onAddToScheme ? (
                  <span className="block px-3 py-1 text-xs text-slate-600">暂无方案</span>
                ) : null}
                {onAddToScheme && <MenuSeparator />}
                {onAddToCollection && (
                  <div className="px-3 py-1 text-[10px] text-slate-500">加入集合</div>
                )}
                {(collections?.length ?? 0) > 0 ? (
                  collections?.map((c) => (
                    <button key={c.id} onClick={() => handleAction(() => onAddToCollection!(c.id))}
                      className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/70 transition-colors truncate">
                      {c.name}
                    </button>
                  ))
                ) : onAddToCollection ? (
                  <span className="block px-3 py-1 text-xs text-slate-600">暂无集合</span>
                ) : null}
              </div>
            )}
          </div>
          <div ref={newRef} className="relative" onMouseEnter={() => { setNewOpen(true); setJoinOpen(false); }}>
            <MenuItem onClick={() => {}} arrow>新建</MenuItem>
            {newOpen && (
              <div ref={newSubRef} className={`absolute top-0 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px] z-[10000] ${subFlip ? "right-full" : "left-full"}`}>
                {onCreateScheme && (
                  <button onClick={() => handleAction(onCreateScheme)}
                    className="w-full text-left px-3 py-1.5 text-sm text-blue-400 hover:bg-slate-700/70 transition-colors">
                    新建方案…
                  </button>
                )}
                {onCreateCollection && (
                  <button onClick={() => handleAction(onCreateCollection)}
                    className="w-full text-left px-3 py-1.5 text-sm text-purple-400 hover:bg-slate-700/70 transition-colors">
                    新建集合…
                  </button>
                )}
              </div>
            )}
          </div>
          <MenuSeparator />
        </>
      )}

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
              subFlip ? "right-full" : "left-full"
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
