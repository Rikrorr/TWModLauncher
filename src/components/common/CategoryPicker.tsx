import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCategoryStore, persistCategories } from "../../store/useCategoryStore";

interface Props {
  modKey: string;
  title: string;
  onClose: () => void;
}

const PALETTE = [
  "#3b82f6", "#22c55e", "#eab308", "#ef4444",
  "#a855f7", "#ec4899", "#14b8a6", "#f97316",
];

/**
 * Tag manager window — checkbox the current mod's tags, plus a dropdown
 * manager to create / rename / recolor user-defined tags.
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
  const [color, setColor] = useState(PALETTE[0]);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLDivElement>(null);

  const matched = useMemo(() => {
    const t = input.trim();
    return categories.find((c) => c.name === t) ?? null;
  }, [categories, input]);

  const selectedTag = matched;

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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
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
  }, [onClose]);

  useEffect(() => {
    if (!renameOpen) return;
    const handler = (e: MouseEvent) => {
      if (renameRef.current && !renameRef.current.contains(e.target as Node)) {
        setRenameOpen(false);
      }
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
    <>
      <div
        ref={ref}
        className="fixed z-[100] w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3"
        style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-200 truncate pr-2" title={title}>
            标签: {title}
          </span>
          <button
            onClick={onClose}
            className="text-[10px] px-1.5 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            ✕
          </button>
        </div>

        <div className="mb-3">
          <p className="text-[10px] text-slate-500 mb-1">当前 Mod 标签</p>
          {categories.length === 0 ? (
            <p className="text-xs text-slate-600">暂无自定义标签</p>
          ) : (
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {categories.map((c) => {
                const checked = current.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 px-1 py-0.5 rounded hover:bg-slate-700/50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTag(c.id)}
                      className="accent-blue-500"
                    />
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ background: c.color ?? "#3b82f6" }}
                    />
                    <span className={`text-xs flex-1 ${checked ? "text-slate-200" : "text-slate-400"}`}>
                      {c.name}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-slate-700 pt-2">
          <p className="text-[10px] text-slate-500 mb-1">管理标签（输入或选择已有标签）</p>
          <input
            list="tag-options"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入新标签名或选择已有标签..."
            className="w-full text-xs px-2 py-1.5 bg-slate-700 border border-slate-600 rounded
                       text-slate-200 outline-none focus:border-blue-500 mb-2"
          />
          <datalist id="tag-options">
            {categories.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>

          <div className="flex items-center gap-1 mb-2">
            <span className="text-[10px] text-slate-500 mr-1">颜色:</span>
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => changeColor(c)}
                className={`w-5 h-5 rounded-full border-2 transition-transform cursor-pointer ${
                  (matched?.color ?? color) === c
                    ? "border-white scale-110"
                    : "border-transparent hover:scale-110"
                }`}
                style={{ background: c }}
              />
            ))}
          </div>

          {selectedTag && (
            <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-700/50 rounded px-2 py-1 mb-2">
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ background: selectedTag.color ?? "#3b82f6" }}
              />
              <span className="truncate flex-1">{selectedTag.name}</span>
              <button
                onClick={() => {
                  deleteCategory(selectedTag.id);
                  persistCategories(useCategoryStore.getState());
                  setInput("");
                }}
                title="删除此标签"
                className="text-[10px] text-red-500 hover:text-red-400 cursor-pointer shrink-0"
              >
                删除
              </button>
            </div>
          )}

          <div className="flex justify-end mt-1">
            {matched ? (
              <button
                onClick={openRename}
                className="text-xs px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded cursor-pointer"
              >
                重命名
              </button>
            ) : (
              <button
                onClick={handleCreate}
                disabled={!input.trim()}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                           text-white rounded cursor-pointer"
              >
                新建
              </button>
            )}
          </div>
        </div>
      </div>

      {renameOpen && matched && (
        <div
          ref={renameRef}
          className="fixed z-[110] bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-4 w-72"
          style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        >
          <p className="text-xs font-medium text-slate-200 mb-2">
            重命名标签「{matched.name}」
          </p>
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
              className="text-xs px-3 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50
                         text-white rounded cursor-pointer"
            >
              确认
            </button>
          </div>
        </div>
      )}
    </>
  );
}