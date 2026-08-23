import { useEffect, useRef, useState } from "react";
import ContextMenu from "../ModList/ContextMenu";

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  /** Mod titles for display */
  modTitle: string;
  /** Single mod context (undefined = multi-select) */
  mod?: {
    key: string;
    fileId: number;
    source: number;
    dirPath: string;
    enabled: boolean;
  };
  /** Multi-select context */
  modCount?: number;
  /** Available schemes for "add to scheme" (duck-typed: name + optional modCount) */
  schemes: { name: string; modCount?: number }[];
  /** Available collections for "add to collection" (duck-typed: id + name) */
  collections: { id: string; name: string }[];
  /** Whether the current container is a scheme (show enable/order/remove) or collection (no enable) */
  containerKind?: "mods" | "scheme" | "collection";
  /** Actions */
  onToggle?: (enabled: boolean) => void;
  onOpenConfig?: () => void;
  onAddToScheme: (schemeName: string) => void;
  onAddToCollection: (collectionId: string) => void;
  onCreateScheme: () => void;
  onCreateCollection: () => void;
  onSetCategories?: () => void;
  onEditNote?: () => void;
  onRemoveFromContainer?: () => void;
  onOpenExplorer?: () => void;
  onOpenWorkshop?: () => void;
  onOrderUp?: () => void;
  onOrderDown?: () => void;
}

function MenuItem({
  onClick,
  children,
  arrow,
  danger,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  arrow?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left px-3 py-1.5 text-sm transition-colors flex items-center gap-2 ${
        disabled
          ? "text-slate-600 cursor-not-allowed"
          : danger
            ? "text-red-400 hover:text-red-300 hover:bg-slate-700/70"
            : "text-slate-200 hover:bg-slate-700/70"
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

/**
 * Unified mod action menu shared by ModsPage / SchemesPage / CollectionsPage.
 * Two-level submenu: 加入 → 方案/集合 → 具体项；新建 → 方案/集合。
 */
export default function ModActionMenu({
  x,
  y,
  onClose,
  modTitle,
  mod,
  modCount,
  schemes,
  collections,
  containerKind = "mods",
  onToggle,
  onOpenConfig,
  onAddToScheme,
  onAddToCollection,
  onCreateScheme,
  onCreateCollection,
  onSetCategories,
  onEditNote,
  onRemoveFromContainer,
  onOpenExplorer,
  onOpenWorkshop,
  onOrderUp,
  onOrderDown,
}: Props) {
  const [addOpen, setAddOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [submenuFlip, setSubmenuFlip] = useState(false);
  const addRef = useRef<HTMLDivElement>(null);
  const addSubRef = useRef<HTMLDivElement>(null);
  const newRef = useRef<HTMLDivElement>(null);
  const newSubRef = useRef<HTMLDivElement>(null);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  // Submenu flip detection (avoid overflow off right edge)
  useEffect(() => {
    if (addOpen && addRef.current) {
      const rect = addRef.current.getBoundingClientRect();
      if (rect.right + 180 > window.innerWidth) setSubmenuFlip(true);
    }
  }, [addOpen]);

  // Close nested submenus when mouse leaves trigger+submenu
  useEffect(() => {
    if (!addOpen && !newOpen) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      const overAdd =
        addRef.current?.contains(t) || addSubRef.current?.contains(t);
      const overNew =
        newRef.current?.contains(t) || newSubRef.current?.contains(t);
      if (!overAdd && !overNew) {
        setAddOpen(false);
        setNewOpen(false);
      }
    };
    document.addEventListener("mousemove", handler);
    return () => document.removeEventListener("mousemove", handler);
  }, [addOpen, newOpen]);

  const count = modCount ?? 1;
  const canEnable = containerKind !== "collection";

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <div className="px-3 py-1.5 text-xs text-slate-400 border-b border-slate-700 mb-1 truncate">
        {count > 1 ? `已选 ${count} 个 Mod` : modTitle}
      </div>

      {/* Enable/disable (not in collection container) */}
      {canEnable && mod && onToggle && (
        <MenuItem onClick={() => handleAction(() => onToggle(!mod.enabled))}>
          {mod.enabled ? "禁用" : "启用"}
        </MenuItem>
      )}
      {canEnable && onOpenConfig && (
        <MenuItem onClick={() => handleAction(onOpenConfig)}>
          打开配置页
        </MenuItem>
      )}

      <MenuSeparator />

      {/* 加入 → 方案/集合 (two-level) */}
      <div ref={addRef} className="relative" onMouseEnter={() => { setAddOpen(true); setNewOpen(false); }}>
        <MenuItem onClick={() => {}} arrow>
          加入
        </MenuItem>
        {addOpen && (
          <div
            ref={addSubRef}
            className={`absolute top-0 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px] z-[10000] ${
              submenuFlip ? "right-full" : "left-full"
            }`}
          >
            {/* → 方案 */}
            <div className="px-3 py-1 text-[10px] text-slate-500">加入方案</div>
            {schemes.length === 0 ? (
              <span className="block px-3 py-1 text-xs text-slate-600">暂无方案</span>
            ) : (
              schemes.map((s) => (
                <button
                  key={s.name}
                  onClick={() => handleAction(() => onAddToScheme(s.name))}
                  className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/70 transition-colors truncate"
                >
                  {s.name}
                </button>
              ))
            )}
            <MenuSeparator />
            {/* → 集合 */}
            <div className="px-3 py-1 text-[10px] text-slate-500">加入集合</div>
            {collections.length === 0 ? (
              <span className="block px-3 py-1 text-xs text-slate-600">暂无集合</span>
            ) : (
              collections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleAction(() => onAddToCollection(c.id))}
                  className="w-full text-left px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700/70 transition-colors truncate"
                >
                  {c.name}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* 新建 → 方案/集合 (two-level) */}
      <div ref={newRef} className="relative" onMouseEnter={() => { setNewOpen(true); setAddOpen(false); }}>
        <MenuItem onClick={() => {}} arrow>
          新建
        </MenuItem>
        {newOpen && (
          <div
            ref={newSubRef}
            className={`absolute top-0 bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-1 min-w-[160px] z-[10000] ${
              submenuFlip ? "right-full" : "left-full"
            }`}
          >
            <button
              onClick={() => handleAction(onCreateScheme)}
              className="w-full text-left px-3 py-1.5 text-sm text-blue-400 hover:bg-slate-700/70 transition-colors"
            >
              新建方案…
            </button>
            <button
              onClick={() => handleAction(onCreateCollection)}
              className="w-full text-left px-3 py-1.5 text-sm text-purple-400 hover:bg-slate-700/70 transition-colors"
            >
              新建集合…
            </button>
          </div>
        )}
      </div>

      <MenuSeparator />

      {/* Organize */}
      {onSetCategories && (
        <MenuItem onClick={() => handleAction(onSetCategories)}>
          设置分类…
        </MenuItem>
      )}
      {onEditNote && (
        <MenuItem onClick={() => handleAction(onEditNote)}>
          编辑备注…
        </MenuItem>
      )}
      {onRemoveFromContainer && containerKind !== "mods" && (
        <MenuItem onClick={() => handleAction(onRemoveFromContainer)} danger>
          {containerKind === "scheme" ? "移出方案" : "移出集合"}
        </MenuItem>
      )}

      <MenuSeparator />

      {/* Order (scheme container only) */}
      {containerKind === "scheme" && (onOrderUp || onOrderDown) && (
        <>
          {onOrderUp && (
            <MenuItem onClick={() => handleAction(onOrderUp)}>上移</MenuItem>
          )}
          {onOrderDown && (
            <MenuItem onClick={() => handleAction(onOrderDown)}>下移</MenuItem>
          )}
          <MenuSeparator />
        </>
      )}

      {/* Filesystem / workshop */}
      {onOpenExplorer && (
        <MenuItem onClick={() => handleAction(onOpenExplorer)}>
          打开所在文件夹
        </MenuItem>
      )}
      {onOpenWorkshop && (
        <MenuItem onClick={() => handleAction(onOpenWorkshop)}>
          Steam Workshop 页面
        </MenuItem>
      )}
    </ContextMenu>
  );
}
