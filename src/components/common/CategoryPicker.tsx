import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCategoryStore, persistCategories } from "../../store/useCategoryStore";

interface Props {
  modKey: string;
  title: string;
  onClose: () => void;
}

/**
 * Tag manager window — AddModPanel-style modal shell with a combobox.
 * The dropdown is rendered via createPortal to document.body so it is never
 * clipped by the panel's overflow/transform; clicking elsewhere in the panel
 * dismisses both the dropdown and the text input focus.
 */
export default function CategoryPicker({ modKey, title, onClose }: Props) {
  const categories = useCategoryStore((s) => s.categories);
  const modCats = useCategoryStore((s) => s.modCats);
  const setModCategories = useCategoryStore((s) => s.setModCategories);
  const addCategory = useCategoryStore((s) => s.addCategory);
  const renameCategory = useCategoryStore((s) => s.renameCategory);
  const deleteCategory = useCategoryStore((s) => s.deleteCategory);

  const current = useMemo(() => modCats[modKey] ?? [], [modCats, modKey]);

  const [input, setInput] = useState("");
  const [color, setColor] = useState("#3b82f6");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [listOpen, setListOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const comboRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDivElement>(null);

  const matched = useMemo(() => {
    const t = input.trim();
    return categories.find((c) => c.name === t) ?? null;
  }, [categories, input]);

  const filtered = useMemo(() => {
    const q = input.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, input]);

  // Open the dropdown: measure the input wrapper position for the portal
  const openList = useCallback(() => {
    const el = inputWrapRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setListOpen(true);
  }, []);

  const dismissInput = useCallback(() => {
    setListOpen(false);
    inputRef.current?.blur();
  }, []);

  const toggleTag = useCallback(
    (catId: string) => {
      const next = current.includes(catId)
        ? current.filter((id) => id !== catId)
        : [...current, catId];
      setModCategories(modKey, next);
      persistCategories(useCategoryStore.getState());
    },
    [current, modKey, setModCategories],
  );

  const handleCreate = () => {
    const name = input.trim();
    if (!name) return;
    addCategory(name, color);
    setInput("");
    persistCategories(useCategoryStore.getState());
  };

  const openRename = () => {
    if (!matched) return;
    setRenameValue(matched.name);
    setRenameOpen(true);
  };

  const confirmRename = () => {
    if (!matched) return;
    const next = renameValue.trim();
    if (next && next !== matched.name) {
      renameCategory(matched.id, next);
      persistCategories(useCategoryStore.getState());
      setInput(next);
    }
    setRenameOpen(false);
  };

  const changeColor = (c: string) => {
    setColor(c);
    if (matched) {
      const state = useCategoryStore.getState();
      useCategoryStore.setState({
        categories: state.categories.map((cat) =>
          cat.id === matched.id ? { ...cat, color: c } : cat,
        ),
      });
      persistCategories(useCategoryStore.getState());
    }
  };

  // Click outside the panel closes the window; click inside but outside the
  // combobox dismisses the dropdown + input focus (cancel typing state).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!panelRef.current) return;
      const inside = panelRef.current.contains(e.target as Node);
      if (!inside) {
        onClose();
        return;
      }
      if (listOpen && comboRef.current && !comboRef.current.contains(e.target as Node)) {
        dismissInput();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose, listOpen, dismissInput]);

  // Rename dialog close
  useEffect(() => {
    if (!renameOpen) return;
    const handler = (e: MouseEvent) => {
      if (renameRef.current && !renameRef.current.contains(e.target as Node)) setRenameOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRenameOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [renameOpen]);

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60">
      <div
        ref={panelRef}
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl
                   w-[560px] max-w-[95vw] max-h-[85vh] flex flex-col"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 shrink-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">标签: {title}</h2>
          <span className="text-[10px] text-slate-500 hidden sm:inline">输入过滤选择 · 新建标签</span>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="relative" ref={comboRef} onMouseDown={(e) => e.stopPropagation()}>
            <div
              ref={inputWrapRef}
              className="flex items-center gap-1.5 flex-wrap border border-slate-600 rounded bg-slate-900 px-2 py-1.5
                          focus-within:border-blue-500 transition-colors"
            >
              {current.map((cid) => {
                const c = categories.find((x) => x.id === cid);
                if (!c) return null;
                return (
                  <span
                    key={cid}
                    className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border text-slate-200"
                    style={{
                      color: c.color ?? "#a855f7",
                      borderColor: (c.color ?? "#a855f7") + "66",
                      background: (c.color ?? "#a855f7") + "1a",
                    }}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: c.color ?? "#a855f7" }} />
                    {c.name}
                    <button
                      onClick={() => toggleTag(cid)}
                      className="ml-0.5 text-slate-400 hover:text-white cursor-pointer"
                      title="移除标签"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => { setInput(e.target.value); openList(); }}
                onFocus={openList}
                onKeyDown={(e) => {
                  if (e.key === "Escape") dismissInput();
                }}
                placeholder={current.length === 0 ? "输入或选择标签..." : ""}
                className="flex-1 min-w-24 bg-transparent text-xs text-slate-200 outline-none placeholder-slate-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 shrink-0">颜色:</span>
            <input
              type="color"
              value={matched?.color ?? color}
              onChange={(e) => changeColor(e.target.value)}
              className="w-8 h-7 rounded cursor-pointer bg-transparent border border-slate-600"
            />
            <span className="text-[10px] text-slate-500 font-mono">{matched?.color ?? color}</span>
            {matched && (
              <span className="text-[10px] text-slate-500 ml-auto">正在管理「{matched.name}」</span>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-700 shrink-0">
          <span className="text-xs text-slate-500">已选 {current.length} 个标签</span>
          <div className="flex gap-2">
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

      {/* Dropdown rendered to document.body — never clipped by the panel */}
      {listOpen && dropdownPos &&
        createPortal(
          <div
            className="fixed bg-slate-800 border border-slate-600 rounded shadow-xl py-1 z-[300] max-h-56 overflow-y-auto"
            style={{ top: dropdownPos.top, left: dropdownPos.left, width: dropdownPos.width }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {filtered.length === 0 ? (
              <p className="text-xs text-slate-500 px-3 py-2">无匹配标签</p>
            ) : (
              filtered.map((c) => {
                const checked = current.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-700/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTag(c.id)}
                      className="accent-blue-500"
                    />
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: c.color ?? "#3b82f6" }}
                    />
                    <span className={`text-xs flex-1 truncate ${checked ? "text-slate-200" : "text-slate-400"}`}>
                      {c.name}
                    </span>
                  </label>
                );
              })
            )}
            <div className="border-t border-slate-700 mt-1 pt-1">
              {matched ? (
                <div className="flex items-center gap-2 px-3 py-1">
                  <span className="text-xs text-slate-400 truncate flex-1">{matched.name}</span>
                  <button
                    onClick={() => { openRename(); setListOpen(false); }}
                    className="text-[10px] px-2 py-0.5 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer shrink-0"
                  >
                    重命名
                  </button>
                  <button
                    onClick={() => {
                      deleteCategory(matched.id);
                      persistCategories(useCategoryStore.getState());
                      setInput("");
                    }}
                    className="text-[10px] px-2 py-0.5 bg-red-600 hover:bg-red-500 text-white rounded cursor-pointer shrink-0"
                  >
                    删除
                  </button>
                </div>
              ) : input.trim() ? (
                <button
                  onClick={() => { handleCreate(); setListOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700/70 transition-colors"
                >
                  + 新建「{input.trim()}」
                </button>
              ) : null}
            </div>
          </div>,
          document.body,
        )}

      {renameOpen && matched && (
        <div
          ref={renameRef}
          className="fixed z-[400] bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 w-72"
          style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <p className="text-xs font-medium text-slate-200 mb-2">重命名标签「{matched.name}」</p>
          <input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && confirmRename()}
            autoFocus
            className="w-full text-xs px-2 py-1.5 bg-slate-700 border border-slate-600 rounded
                       text-slate-200 outline-none focus:border-blue-500 mb-3"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setRenameOpen(false)}
              className="text-xs px-3 py-1 border border-slate-600 text-slate-300 rounded cursor-pointer"
            >
              取消
            </button>
            <button
              onClick={confirmRename}
              disabled={!renameValue.trim()}
              className="text-xs px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded cursor-pointer"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </div>
  );
}