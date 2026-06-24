import { useState, useEffect, useCallback } from "react";
import type { ModInfo } from "../../lib/types";
import { renderColoredText } from "../../utils/renderColoredText";
import { openInExplorer } from "../../lib/tauriApi";

interface Props {
  mod: ModInfo;
  disabled?: boolean;
  onToggle: (fileId: number, enabled: boolean) => void;
  onSelect: () => void;
  onOrderUp?: (e: React.MouseEvent) => void;
  onOrderDown?: (e: React.MouseEvent) => void;
  onOrderChange?: (order: number) => void;
  /** Custom drag: initiate on mousedown */
  onDragMouseDown?: (e: React.MouseEvent, key: string) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
}

const INTERACTIVE_SELECTOR = "button, input, label, select, [data-no-drag]";

export default function ModCard({
  mod,
  disabled,
  onToggle,
  onSelect,
  onOrderUp,
  onOrderDown,
  onOrderChange,
  onDragMouseDown,
  isDragging,
  isDragOver,
}: Props) {
  const [localOrder, setLocalOrder] = useState(mod.order);

  useEffect(() => {
    setLocalOrder(mod.order);
  }, [mod.order]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!onDragMouseDown) return;
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      const key = `${mod.source}_${mod.fileId}`;
      onDragMouseDown(e, key);
    },
    [onDragMouseDown, mod.source, mod.fileId],
  );

  const sourceLabel = mod.source === 1 ? "创意工坊" : "本地";
  const sourceColor =
    mod.source === 1
      ? "bg-blue-900/60 text-blue-300 border-blue-700"
      : "bg-emerald-900/60 text-emerald-300 border-emerald-700";

  return (
    <div
      onClick={onSelect}
      onMouseDown={handleMouseDown}
      className={`flex items-start gap-4 rounded-lg border p-4 transition-colors hover:border-slate-500 cursor-pointer ${
        mod.enabled
          ? "border-slate-600 bg-slate-800/80"
          : "border-slate-700/50 bg-slate-800/40 opacity-70"
      } ${mod.parseError ? "border-red-800 bg-red-950/20" : ""} ${
        isDragging ? "opacity-30" : ""
      } ${
        isDragOver ? "border-blue-500 bg-blue-950/30" : ""
      }`}
    >
      {/* Cover image */}
      {mod.coverData ? (
        <img
          src={mod.coverData}
          alt=""
          className="w-[88px] h-[88px] rounded object-cover bg-slate-700 shrink-0 pointer-events-none"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="w-[88px] h-[88px] rounded bg-slate-700 shrink-0 flex items-center justify-center text-slate-500 text-xs">
          无封面
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h3
            className={`font-semibold text-sm truncate ${
              mod.enabled ? "text-slate-100" : "text-slate-400"
            }`}
            title={mod.title}
          >
            {renderColoredText(mod.title)}
          </h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${sourceColor}`}>
            {sourceLabel}
          </span>
          {mod.parseError && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-900/60 text-red-300 border-red-700">
              解析失败
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
          <span title={mod.author}>作者: {mod.author}</span>
          {mod.version && <span>v{mod.version}</span>}
          {mod.gameVersion && (
            <span className="text-slate-500">游戏 {mod.gameVersion}</span>
          )}
          {mod.updatedAt && (
            <span className="text-slate-500">更新 {mod.updatedAt}</span>
          )}
        </div>

        {mod.description && (
          <p
            className="text-xs text-slate-500 mt-1.5 line-clamp-2"
            title={mod.description}
          >
            {renderColoredText(mod.description)}
          </p>
        )}

        {mod.tagList.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {mod.tagList.map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right sidebar: toggle / order / actions */}
      <div className="flex flex-col items-center gap-3 shrink-0">
        {/* Enable toggle */}
        <label
          onClick={(e) => e.stopPropagation()}
          className={`relative inline-flex items-center ${
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
          }`}
        >
          <input
            type="checkbox"
            checked={mod.enabled}
            disabled={disabled}
            onChange={(e) => onToggle(mod.fileId, e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-slate-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
        </label>

        {/* Order controls */}
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={onOrderUp}
            title="加载顺序 +1"
            className="text-slate-500 hover:text-slate-200 cursor-pointer transition-colors px-1 text-xs"
          >
            ▲
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={localOrder}
            onChange={(e) => {
              const raw = e.target.value.replace(/^0+/, "");
              const v = parseInt(raw, 10);
              setLocalOrder(raw === "" || isNaN(v) ? 0 : v);
            }}
            onBlur={() => {
              const clamped = Math.max(0, Math.floor(localOrder));
              setLocalOrder(clamped);
              if (clamped !== mod.order) {
                onOrderChange?.(clamped);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            onClick={(e) => e.stopPropagation()}
            title="加载顺序（可直接输入）"
            className="w-11 text-center bg-slate-700 border border-slate-600 rounded text-slate-300 text-xs px-1 py-0.5
                       outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={onOrderDown}
            title="加载顺序 -1"
            className="text-slate-500 hover:text-slate-200 cursor-pointer transition-colors px-1 text-xs"
          >
            ▼
          </button>
        </div>

        {/* Open folder */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            openInExplorer(mod.dirPath).catch(() => {});
          }}
          title="打开 Mod 所在文件夹"
          className="text-[10px] text-slate-600 hover:text-slate-400 cursor-pointer transition-colors"
        >
          打开目录
        </button>
      </div>
    </div>
  );
}
