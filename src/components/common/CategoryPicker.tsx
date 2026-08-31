import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useCategoryStore, persistCategories } from "../../store/useCategoryStore";

interface Props {
  modKey: string;
  title: string;
  onClose: () => void;
}

interface TagDialog {
  mode: "create" | "edit";
  id: string | null;
  name: string;
  color: string;
}

/**
 * Tag manager — click-select interaction.
 * Single click = select only that tag; Ctrl/Cmd+click toggles; Shift+click selects a range
 * (selection == the mod's tags, applied immediately).
 * Row-end "→" opens the shared create/edit dialog (name + color) with duplicate-name check.
 */
export default function CategoryPicker({ modKey, title, onClose }: Props) {
  const categories = useCategoryStore((s) => s.categories);
  const modCats = useCategoryStore((s) => s.modCats);
  const setModCategories = useCategoryStore((s) => s.setModCategories);
  const addCategory = useCategoryStore((s) => s.addCategory);

  const current = useMemo(() => modCats[modKey] ?? [], [modCats, modKey]);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>(current);
  const [lastClicked, setLastClicked] = useState<string | null>(null);
  const [dialog, setDialog] = useState<TagDialog | null>(null);
  const [error, setError] = useState("");

  const panelRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, search]);

  /** Apply selection: single click = radio, Ctrl/Cmd = toggle, Shift = range. */
  const handleRowClick = (id: string, e: ReactMouseEvent<HTMLDivElement>) => {
    let next: string[];
    if (e.shiftKey && lastClicked) {
      const a = filtered.findIndex((c) => c.id === lastClicked);
      const b = filtered.findIndex((c) => c.id === id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        next = filtered.slice(lo, hi + 1).map((c) => c.id);
      } else {
        next = [id];
      }
    } else if (e.ctrlKey || e.metaKey) {
      next = selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id];
    } else {
      next = [id];
    }
    setSelected(next);
    setLastClicked(id);
    setModCategories(modKey, next);
    persistCategories(useCategoryStore.getState());
  };

  const openCreate = () => {
    setError("");
    setDialog({ mode: "create", id: null, name: "", color: "#3b82f6" });
  };

  const openEdit = (c: { id: string; name: string; color?: string }) => {
    setError("");
    setDialog({ mode: "edit", id: c.id, name: c.name, color: c.color ?? "#3b82f6" });
  };

  const confirmDialog = () => {
    if (!dialog) return;
    const name = dialog.name.trim();
    if (!name) {
      setError("名称不能为空");
      return;
    }
    const dup = categories.some(
      (c) =>
        c.name.trim().toLowerCase() === name.toLowerCase() &&
        (dialog.mode === "edit" ? c.id !== dialog.id : true),
    );
    if (dup) {
      setError("已存在同名标签");
      return;
    }
    if (dialog.mode === "create") {
      addCategory(name, dialog.color);
    } else if (dialog.id) {
      const state = useCategoryStore.getState();
      useCategoryStore.setState({
        categories: state.categories.map((c) =>
          c.id === dialog.id ? { ...c, name, color: dialog.color } : c,
        ),
      });
    }
    persistCategories(useCategoryStore.getState());
    setDialog(null);
    setError("");
  };

  const removeTag = (catId: string) => {
    useCategoryStore.getState().deleteCategory(catId);
    persistCategories(useCategoryStore.getState());
    setSelected((prev) => prev.filter((x) => x !== catId));
    if (lastClicked === catId) setLastClicked(null);
  };

  // Panel: click outside / Escape closes (inert while the inner dialog is open)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (dialogRef.current && dialogRef.current.contains(t)) return;
      if (panelRef.current && !panelRef.current.contains(t)) onClose();
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !dialog) onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose, dialog]);

  // Dialog: click outside / Escape closes
  useEffect(() => {
    if (!dialog) return;
    const handler = (e: MouseEvent) => {
      if (dialogRef.current && !dialogRef.current.contains(e.target as Node)) {
        setDialog(null);
        setError("");
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDialog(null);
        setError("");
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [dialog]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
      <div
        ref={panelRef}
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[640px] max-w-[95vw] max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">标签: {title}</h2>
          <span className="text-[10px] text-slate-500 hidden sm:inline">
            单击选中 · Ctrl 多选 · Shift 范围
          </span>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none"
          >
            ×
          </button>
        </div>

        {/* Search + list */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="px-4 pt-3 pb-2 shrink-0">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标签..."
              className="w-full text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">
                {categories.length === 0 ? "暂无标签" : "无匹配标签"}
              </p>
            ) : (
              filtered.map((c) => {
                const isSel = selected.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={(e) => handleRowClick(c.id, e)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer select-none transition-colors ${
                      isSel ? "bg-blue-800/40" : "hover:bg-slate-700/50"
                    }`}
                  >
                    <span
                      className={`w-4 shrink-0 text-xs text-center ${
                        isSel ? "text-blue-400" : "text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: c.color ?? "#3b82f6" }}
                    />
                    <span
                      className={`text-xs flex-1 truncate ${
                        isSel ? "text-slate-100" : "text-slate-300"
                      }`}
                    >
                      {c.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(c);
                      }}
                      title="修改标签"
                      className="text-xs px-1.5 py-0.5 text-slate-500 hover:text-amber-300 rounded cursor-pointer shrink-0"
                    >
                      →
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTag(c.id);
                      }}
                      title="删除标签"
                      className="text-[10px] px-1.5 py-0.5 text-slate-500 hover:text-red-400 rounded cursor-pointer shrink-0"
                    >
                      删除
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 shrink-0">
          <button
            onClick={openCreate}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
          >
            + 新建标签
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">已选 {selected.length} 个</span>
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={onClose}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
            >
              完成
            </button>
          </div>
        </div>
      </div>

      {/* Shared create/edit dialog */}
      {dialog && (
        <div
          ref={dialogRef}
          className="fixed z-[400] bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 w-80"
          style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <p className="text-xs font-medium text-slate-200 mb-2">
            {dialog.mode === "create" ? "新建标签" : `修改「${dialog.name}」`}
          </p>
          <input
            value={dialog.name}
            onChange={(e) => {
              setDialog({ ...dialog, name: e.target.value });
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmDialog();
            }}
            autoFocus
            placeholder="标签名称..."
            className="w-full text-xs px-2 py-1.5 bg-slate-700 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500 mb-3"
          />
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs text-slate-400 shrink-0">颜色:</span>
            <input
              type="color"
              value={dialog.color}
              onChange={(e) => setDialog({ ...dialog, color: e.target.value })}
              className="w-8 h-7 rounded cursor-pointer bg-transparent border border-slate-600"
            />
            <span className="text-[10px] text-slate-500 font-mono">{dialog.color}</span>
          </div>
          {error && <p className="text-xs text-red-400 mb-2">{error}</p>}
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => {
                setDialog(null);
                setError("");
              }}
              className="text-xs px-3 py-1 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={confirmDialog}
              className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}