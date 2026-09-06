import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface ContainerOption {
  key: string;
  label: string;
  count?: number;
  /** e.g. active marker for schemes */
  meta?: string;
}

interface Props {
  placeholder: string;
  options: ContainerOption[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** Delete action rendered inside the dropdown (per option). */
  onDelete?: (key: string) => void;
  /** ★ v2.1: rename action rendered inside the dropdown (per option). */
  onRename?: (key: string) => void;
  /** Extra header action (e.g. new container). Receives a close() to dismiss the dropdown. */
  headerAction?: (close: () => void) => React.ReactNode;
}

const PANEL_W = 288;

/** Dropdown container selector — pick scheme/collection; delete lives inside the dropdown.
 *  The option panel is portaled to document.body (fixed, positioned from the button rect)
 *  so it is never clipped by overflow-hidden ancestors, following the ContextMenu pattern. */
export default function ContainerSelect({
  placeholder,
  options,
  selectedKey,
  onSelect,
  onDelete,
  onRename,
  headerAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);

  const selected = options.find((o) => o.key === selectedKey) ?? null;

  const openMenu = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(r.left, Math.max(8, window.innerWidth - PANEL_W - 8)),
      top: r.bottom + 4,
      up: false,
    });
    setOpen(true);
  };

  // Reposition while open (scroll / resize) so the panel stays pinned to the button.
  useEffect(() => {
    if (!open) return;
    const update = () => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos((prev) =>
        prev
          ? {
              left: Math.min(r.left, Math.max(8, window.innerWidth - PANEL_W - 8)),
              top: r.bottom + 4,
              up: false,
            }
          : prev,
      );
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [open]);

  // Flip upward when the panel would overflow the viewport bottom.
  useEffect(() => {
    if (!open || !pos || !panelRef.current) return;
    const pr = panelRef.current.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - 8) {
      const el = wrapRef.current;
      if (el) {
        const r = el.getBoundingClientRect();
        setPos((p) => (p ? { ...p, top: r.top - 4 - pr.height, up: true } : p));
      }
    }
  }, [open, pos]);

  // Close on outside click (wrapper OR panel) / Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={wrapRef}>
      <button
        onClick={() => (open ? setOpen(false) : openMenu())}
        className="min-w-52 max-w-72 text-xs px-3 py-1.5 bg-slate-800 border border-slate-600
                   hover:border-slate-400 rounded text-slate-200 cursor-pointer
                   flex items-center justify-between gap-2 transition-colors"
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && pos &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed bg-slate-800 border border-slate-600 rounded-lg shadow-xl z-[9999] py-1"
            style={{ left: pos.left, top: pos.top, width: PANEL_W }}
          >
            {headerAction && (
              <div className="px-2 py-1 border-b border-slate-700">{headerAction(() => setOpen(false))}</div>
            )}
            <div className="max-h-64 overflow-y-auto">
              {options.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-3">暂无选项</p>
              ) : (
                options.map((o) => {
                  const isSelected = o.key === selectedKey;
                  return (
                    <div
                      key={o.key}
                      onClick={() => {
                        onSelect(o.key);
                        setOpen(false);
                      }}
                      className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer
                                 transition-colors ${
                                   isSelected
                                     ? "bg-blue-900/40 text-blue-300"
                                     : "text-slate-200 hover:bg-slate-700/70"
                                 }`}
                    >
                      <span className="flex-1 truncate">
                        {o.meta ? `${o.meta} ` : ""}{o.label}
                      </span>
                      {typeof o.count === "number" && (
                        <span className="text-slate-500 shrink-0">{o.count} Mod</span>
                      )}
                      {onRename && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRename(o.key);
                          }}
                          title="重命名"
                          className="text-[10px] px-1.5 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded shrink-0 cursor-pointer"
                        >
                          改名
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(o.key);
                          }}
                          title="删除"
                          className="text-[10px] px-1.5 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded shrink-0 cursor-pointer"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}