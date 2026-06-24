import type { ModInfo } from "../../lib/types";
import { renderColoredText } from "../../utils/renderColoredText";

interface Props {
  mod: ModInfo;
  disabled?: boolean;
  onToggle: (fileId: number, enabled: boolean) => void;
  onSelect: () => void;
  /** Show order controls (when sorted by order) */
  showOrder?: boolean;
  orderNum?: number;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: (e: React.MouseEvent) => void;
  onMoveDown?: (e: React.MouseEvent) => void;
}

export default function ModCard({
  mod,
  disabled,
  onToggle,
  onSelect,
  showOrder,
  orderNum,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: Props) {
  const sourceLabel = mod.source === 1 ? "创意工坊" : "本地";
  const sourceColor =
    mod.source === 1
      ? "bg-blue-900/60 text-blue-300 border-blue-700"
      : "bg-emerald-900/60 text-emerald-300 border-emerald-700";

  return (
    <div
      onClick={onSelect}
      className={`flex items-start gap-4 rounded-lg border p-4 transition-colors cursor-pointer hover:border-slate-500 ${
        mod.enabled
          ? "border-slate-600 bg-slate-800/80"
          : "border-slate-700/50 bg-slate-800/40 opacity-70"
      } ${mod.parseError ? "border-red-800 bg-red-950/20" : ""}`}
    >
      {/* Enable toggle */}
      <label
        onClick={(e) => e.stopPropagation()}
        className={`relative inline-flex items-center shrink-0 mt-0.5 ${
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

      {/* Cover image */}
      {mod.coverData ? (
        <img
          src={mod.coverData}
          alt=""
          className="w-20 h-20 rounded object-cover bg-slate-700 shrink-0"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : (
        <div className="w-20 h-20 rounded bg-slate-700 shrink-0 flex items-center justify-center text-slate-500 text-xs">
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
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border ${sourceColor}`}
          >
            {sourceLabel}
          </span>
          {mod.parseError && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-900/60 text-red-300 border-red-700">
              解析失败
            </span>
          )}
          {showOrder && (
            <span
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-0.5 text-[10px] text-slate-500 ml-auto shrink-0"
            >
              <button
                disabled={!canMoveUp}
                onClick={onMoveUp}
                title="上移"
                className="text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:cursor-default cursor-pointer transition-colors px-0.5"
              >
                ▲
              </button>
              <span className="min-w-4 text-center" title="加载顺序">
                {(orderNum ?? mod.order) || "-"}
              </span>
              <button
                disabled={!canMoveDown}
                onClick={onMoveDown}
                title="下移"
                className="text-slate-500 hover:text-slate-200 disabled:opacity-20 disabled:cursor-default cursor-pointer transition-colors px-0.5"
              >
                ▼
              </button>
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
          <span title={mod.author}>作者: {mod.author}</span>
          {mod.version && <span>v{mod.version}</span>}
          {mod.gameVersion && (
            <span className="text-slate-500">游戏 {mod.gameVersion}</span>
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
    </div>
  );
}
