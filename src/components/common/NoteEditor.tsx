import { useEffect, useRef, useState } from "react";
import { useNoteStore, persistNotes } from "../../store/useNoteStore";

interface Props {
  modKey: string;
  title: string;
  onClose: () => void;
}

/** Note editor popup — one multiline note per mod. */
export default function NoteEditor({ modKey, title, onClose }: Props) {
  const notes = useNoteStore((s) => s.notes);
  const setNote = useNoteStore((s) => s.setNote);
  const clearNote = useNoteStore((s) => s.clearNote);
  const [text, setText] = useState(notes[modKey] ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSave = () => {
    const trimmed = text.trim();
    if (trimmed) {
      setNote(modKey, trimmed);
    } else {
      clearNote(modKey);
    }
    persistNotes(useNoteStore.getState());
    onClose();
  };

  // Close on outside click / Escape; autofocus textarea
  useEffect(() => {
    textareaRef.current?.focus();
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

  return (
    <div
      ref={ref}
      className="fixed z-[100] w-80 bg-slate-800 border border-slate-600 rounded-lg shadow-xl p-3"
      style={{ left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-200 truncate pr-2" title={title}>
          备注: {title}
        </span>
        <button
          onClick={onClose}
          className="text-[10px] px-1.5 py-0.5 text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          ✕
        </button>
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        placeholder="记录这个 Mod 的用途、冲突、注意事项..."
        rows={5}
        className="w-full text-xs px-2 py-1.5 bg-slate-700 border border-slate-600 rounded
                   text-slate-200 outline-none focus:border-blue-500 resize-y select-text"
      />

      <div className="flex items-center justify-end gap-2 mt-2">
        <button
          onClick={() => {
            clearNote(modKey);
            persistNotes(useNoteStore.getState());
            onClose();
          }}
          className="text-xs px-2 py-1 text-slate-400 hover:text-red-400 cursor-pointer"
        >
          清除
        </button>
        <button
          onClick={handleSave}
          className="text-xs px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
        >
          保存
        </button>
      </div>
    </div>
  );
}
