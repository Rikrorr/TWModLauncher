import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  /** Pre-filled current name */
  defaultValue: string;
  /** Optional hint when the new name is invalid (e.g. sanitized/empty). */
  hint?: string;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/** Small modal dialog for renaming a scheme/collection. */
export default function RenameDialog({ title, defaultValue, hint, onSubmit, onClose }: Props) {
  const [name, setName] = useState(defaultValue);
  const ref = useRef<HTMLDivElement>(null);

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

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60">
      <div
        ref={ref}
        className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-[380px] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 cursor-pointer text-lg leading-none">
            ×
          </button>
        </div>
        <label className="block mb-1 text-xs text-slate-400">名称</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          className="w-full text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500 mb-2"
          autoFocus
        />
        {hint && <p className="text-xs text-amber-400 mb-2">{hint}</p>}
        <div className="flex justify-end gap-2 mt-1">
          <button onClick={onClose} className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer">
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded cursor-pointer"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
