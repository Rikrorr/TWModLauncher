import { useEffect, useRef, useState } from "react";

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
  /** Extra header action (e.g. new container). */
  headerAction?: React.ReactNode;
}

/** Dropdown container selector — pick scheme/collection; delete lives inside the dropdown. */
export default function ContainerSelect({
  placeholder,
  options,
  selectedKey,
  onSelect,
  onDelete,
  headerAction,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.key === selectedKey) ?? null;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
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
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="min-w-52 max-w-72 text-xs px-3 py-1.5 bg-slate-800 border border-slate-600
                   hover:border-slate-400 rounded text-slate-200 cursor-pointer
                   flex items-center justify-between gap-2 transition-colors"
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 bg-slate-800 border border-slate-600
                        rounded-lg shadow-xl z-50 py-1">
          {headerAction && (
            <div className="px-2 py-1 border-b border-slate-700">{headerAction}</div>
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
        </div>
      )}
    </div>
  );
}
