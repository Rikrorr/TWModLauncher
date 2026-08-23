import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  namePlaceholder: string;
  showDescription?: boolean;
  /** Pre-filled default name (e.g. auto-incremented). */
  defaultName?: string;
  onSubmit: (name: string, description?: string) => void;
  onClose: () => void;
}

/** Modal dialog for creating a scheme/collection — collect name + optional description. */
export default function CreateDialog({
  title,
  namePlaceholder,
  showDescription,
  defaultName,
  onSubmit,
  onClose,
}: Props) {
  const [name, setName] = useState(defaultName ?? "");
  const [desc, setDesc] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
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
    onSubmit(trimmed, showDescription ? desc.trim() || undefined : undefined);
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
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder={namePlaceholder}
          className="w-full text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500 mb-3"
        />

        {showDescription && (
          <>
            <label className="block mb-1 text-xs text-slate-400">描述（可选）</label>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              rows={3}
              placeholder="集合描述、用途等..."
              className="w-full text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded text-slate-200 outline-none focus:border-blue-500 resize-y mb-3"
            />
          </>
        )}

        <div className="flex justify-end gap-2 mt-1">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded cursor-pointer"
          >
            创建
          </button>
        </div>
      </div>
    </div>
  );
}
