import { useState, useEffect, useCallback } from "react";
import type { ModInfo } from "../../lib/types";
import { renderColoredText } from "../../utils/renderColoredText";
import { openInExplorer, openSteamWorkshop, openWorkshopUrl } from "../../lib/tauriApi";
import { message } from "@tauri-apps/plugin-dialog";
import { createLogger } from "../../lib/logger";
import { useCategoryStore } from "../../store/useCategoryStore";
import { useNoteStore } from "../../store/useNoteStore";
import CategoryPicker from "../common/CategoryPicker";
import NoteEditor from "../common/NoteEditor";
import ConflictDialog from "../common/ConflictDialog";
import type { ConflictGroup } from "../../hooks/useConflictDetection";

interface Props {
  mod: ModInfo;
  disabled?: boolean;
  onToggle: (fileId: number, enabled: boolean) => void;
  onSelect: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onOrderUp?: (e: React.MouseEvent) => void;
  onOrderDown?: (e: React.MouseEvent) => void;
  onOrderChange?: (order: number) => void;
  onOrderFocus?: () => void;
  /** Custom drag: initiate on mousedown */
  onDragMouseDown?: (e: React.MouseEvent, key: string) => void;
  isDragging?: boolean;
  isDragOver?: boolean;
  isSelected?: boolean;
  viewMode?: "detailed" | "compact";
  /** ★ v2: conflict groups involving this mod */
  conflicts?: ConflictGroup[];
  /** ★ v2: modKey → title map for conflict dialog (optional, falls back to keys) */
  modTitles?: Record<string, string>;
  /** ★ hide toggle & order controls (browse-only list, e.g. ModsPage). */
  hideToggleAndOrder?: boolean;
  /** ★ hide only the enable/disable switch (e.g. CollectionsPage — no enable semantics). */
  hideToggle?: boolean;
  /** ★ hide only the load-order controls (▲/input/▼) — order lives elsewhere. */
  hideOrder?: boolean;
  /** ★ render the card without enabled/disabled visual differentiation
   *  (pool/browse pages like ModsPage, CollectionsPage, AddModPanel). */
  hideEnabledState?: boolean;
}

const INTERACTIVE_SELECTOR = "button, input, label, select, [data-no-drag]";

const log = createLogger("ModCard");

export default function ModCard({
  mod,
  disabled,
  onToggle,
  onSelect,
  onDoubleClick,
  onOrderUp,
  onOrderDown,
  onOrderChange,
  onOrderFocus,
  onDragMouseDown,
  isDragging,
  isDragOver,
  isSelected,
  viewMode = "detailed",
  conflicts,
  modTitles,
  hideToggleAndOrder,
  hideToggle,
  hideOrder,
  hideEnabledState,
}: Props) {
  const [localOrder, setLocalOrder] = useState(mod.order);
  // ★ hideEnabledState: pool/browse pages show cards uniformly regardless of
  // enabled/disabled — only the visual classes differ, the data stays intact.
  const displayEnabled = hideEnabledState ? true : mod.enabled;
  // ★ v2: category/note popups + store reads
  const [catPickerOpen, setCatPickerOpen] = useState(false);
  const [noteEditorOpen, setNoteEditorOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const modKey = `${mod.source}_${mod.fileId}`;
  const catDefs = useCategoryStore((s) => s.categories);
  // ★ zustand v5: selector must return a cached/stable reference — reading the
  // raw value (undefined when absent) and falling back here avoids allocating
  // a new array every render, which would cause an infinite update loop.
  const catIdsRaw = useCategoryStore((s) => s.modCats[modKey]);
  const catIds = catIdsRaw ?? [];
  const noteText = useNoteStore((s) => s.notes[modKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync external prop change to local state
    setLocalOrder(mod.order);
  }, [mod.order]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const key = `${mod.source}_${mod.fileId}`;
      if (!onDragMouseDown) {
        log.debug(`[drag-card] mousedown ignored: no onDragMouseDown for ${key}`);
        return;
      }
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) {
        log.debug(`[drag-card] mousedown ignored: interactive target for ${key} ${target.tagName}`);
        return;
      }
      log.debug(`[drag-card] mousedown -> onDragMouseDown for ${key}`);
      onDragMouseDown(e, key);
    },
    [onDragMouseDown, mod.source, mod.fileId],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't select when clicking interactive elements
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      onSelect(e);
    },
    [onSelect],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't trigger double-click on interactive elements
      const target = e.target as HTMLElement;
      if (target.closest(INTERACTIVE_SELECTOR)) return;
      onDoubleClick?.();
    },
    [onDoubleClick],
  );

  const selectedClass = isSelected
    ? "ring-2 ring-blue-500 bg-blue-950/20"
    : "";

  const sourceLabel = mod.source === 1 ? "创意工坊" : "本地";
  const sourceIcon = mod.source === 1 ? "⬇" : "🗂";
  const sourceColor =
    mod.source === 1
      ? "bg-blue-900/60 text-blue-300 border-blue-700"
      : "bg-emerald-900/60 text-emerald-300 border-emerald-700";

  if (viewMode === "compact") {
    return (
      <div
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 transition-colors hover:border-slate-500 cursor-pointer ${
          displayEnabled
            ? "border-slate-600 bg-slate-800/80"
            : "border-slate-700/50 bg-slate-800/40 opacity-70"
        } ${mod.parseError ? "border-red-800 bg-red-950/20" : ""} ${
          isDragging ? "opacity-30" : ""
        } ${
          isDragOver ? "border-blue-500 bg-blue-950/30" : ""
        } ${selectedClass}`}
      >
        {/* 1. Name */}
        <h3
          className={`font-semibold text-xs truncate min-w-0 shrink-0 ${
            displayEnabled ? "text-slate-100" : "text-slate-400"
          }`}
          title={mod.title}
          style={{ maxWidth: 200 }}
        >
          {renderColoredText(mod.title)}
        </h3>

        {/* Spacer: push everything else to the right */}
        <div className="flex-1 min-w-0" />

        {/* 2. Source badge */}
        <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${sourceColor}`} title={sourceLabel}>
          {sourceIcon}
        </span>

        {/* 3. Type tags */}
        {mod.tagList.length > 0 && (
          <div className="flex gap-1 shrink-0">
            {mod.tagList.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400"
              >
                {tag}
              </span>
            ))}
            {mod.tagList.length > 3 && (
              <span className="text-[10px] text-slate-500">+{mod.tagList.length - 3}</span>
            )}
          </div>
        )}

        {/* 4. Author */}
        <span className="text-[10px] text-slate-400 shrink-0 truncate max-w-24" title={mod.author}>
          {mod.author}
        </span>

        {/* 5. Version */}
        {mod.version && (
          <span className="text-[10px] text-slate-400 shrink-0">v{mod.version}</span>
        )}

        {/* 6. Game version */}
        {mod.gameVersion && (
          <span className="text-[10px] text-slate-500 shrink-0">{mod.gameVersion}</span>
        )}

        {/* 7. Updated time */}
        {mod.updatedAt && (
          <span className="text-[10px] text-slate-500 shrink-0">{mod.updatedAt}</span>
        )}

        {/* 8+9. Order controls + Toggle — hidden in browse-only mode */}
        {!hideToggleAndOrder && (
          <>
        {!hideOrder && (
        <div
          className="flex items-center gap-0.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onOrderUp}
            title="提前一位（位置 -1）"
            className="text-slate-500 hover:text-slate-200 cursor-pointer transition-colors text-[10px]"
          >
            ▲
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={localOrder}
            onFocus={() => onOrderFocus?.()}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setLocalOrder(mod.order);
                return;
              }
              const stripped = raw.replace(/^0+/, "");
              const v = parseInt(stripped || "0", 10);
              if (isNaN(v)) {
                setLocalOrder(mod.order);
                return;
              }
              setLocalOrder(v);
            }}
            onBlur={() => {
              const floored = Math.floor(localOrder);
              if (floored < 0 || isNaN(floored)) {
                setLocalOrder(mod.order);
                return;
              }
              setLocalOrder(floored);
              if (floored !== mod.order) {
                onOrderChange?.(floored);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            title="加载顺序（可直接输入）"
            className="w-9 text-center bg-slate-700 border border-slate-600 rounded text-slate-300 text-[10px] px-1 py-0.5
                       outline-none focus:border-blue-500 transition-colors select-text"
          />
          <button
            onClick={onOrderDown}
            title="延后一位（位置 +1）"
            className="text-slate-500 hover:text-slate-200 cursor-pointer transition-colors text-[10px]"
          >
            ▼
          </button>
        </div>
        )}

        {/* 9. Toggle — hidden when hideToggle (collections: no enable semantics) */}
        {!hideToggle && (
        <label
          onClick={(e) => e.stopPropagation()}
          className={`relative inline-flex items-center shrink-0 ${
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
        )}
          </>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      className={`flex items-start gap-4 rounded-lg border p-4 transition-colors hover:border-slate-500 cursor-pointer ${
        displayEnabled
          ? "border-slate-600 bg-slate-800/80"
          : "border-slate-700/50 bg-slate-800/40 opacity-70"
      } ${mod.parseError ? "border-red-800 bg-red-950/20" : ""} ${
        isDragging ? "opacity-30" : ""
      } ${
        isDragOver ? "border-blue-500 bg-blue-950/30" : ""
      } ${selectedClass}`}
    >
      {/* Cover image — only in detailed mode */}
      {viewMode === "detailed" && (
        mod.coverData ? (
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
        )
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        {/* ★ v3: first row = 名称 + 来源标签 + 官方标签 + 自定义标签 */}
        <div className="flex items-center gap-2 flex-wrap">
          <h3
            className={`font-semibold text-sm truncate max-w-44 ${
              displayEnabled ? "text-slate-100" : "text-slate-400"
            }`}
            title={mod.title}
          >
            {renderColoredText(mod.title)}
          </h3>
          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${sourceColor}`} title={sourceLabel}>
            {sourceIcon} {sourceLabel}
          </span>
          {/* Official tags */}
          {mod.tagList.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-400 shrink-0"
            >
              {tag}
            </span>
          ))}
          {mod.tagList.length > 4 && (
            <span className="text-[10px] text-slate-500 shrink-0">+{mod.tagList.length - 4}</span>
          )}
          {/* ★ v3: user-defined tags (click to edit) */}
          {catIds.map((cid) => {
            const def = catDefs.find((c) => c.id === cid);
            if (!def) return null;
            return (
              <button
                key={cid}
                onClick={(e) => {
                  e.stopPropagation();
                  setCatPickerOpen(true);
                }}
                className="text-[10px] px-1.5 py-0.5 rounded border shrink-0 inline-flex items-center gap-1
                           hover:brightness-125 cursor-pointer transition-all"
                style={{
                  color: def.color ?? "#a855f7",
                  borderColor: (def.color ?? "#a855f7") + "66",
                  background: (def.color ?? "#a855f7") + "1a",
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: def.color ?? "#a855f7" }} />
                {def.name}
              </button>
            );
          })}
          {catIds.length === 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCatPickerOpen(true);
              }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-slate-600
                         text-slate-500 hover:text-slate-300 hover:border-slate-400 shrink-0 cursor-pointer"
            >
              + 标签
            </button>
          )}
          {/* ★ v2: conflict badge */}
          {conflicts && conflicts.length > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConflictOpen(true);
              }}
              title={conflicts.some((c) => c.severity === "high") ? "检测到 DLL 冲突" : "检测到疑似设置项重复"}
              className={`text-[10px] px-1.5 py-0.5 rounded border cursor-pointer shrink-0 transition-colors ${
                conflicts.some((c) => c.severity === "high")
                  ? "bg-red-900/60 text-red-300 border-red-700 hover:bg-red-800/60"
                  : "bg-amber-900/60 text-amber-300 border-amber-700 hover:bg-amber-800/60"
              }`}
            >
              {conflicts.some((c) => c.severity === "high") ? "🔴 冲突" : "🟡 疑似"}
            </button>
          )}
          {mod.parseError && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-red-900/60 text-red-300 border-red-700 shrink-0">
              解析失败
            </span>
          )}
        </div>

        {/* ★ v3: meta row — author/version/gameVersion/updatedAt, then dir path + copy (truncated when tight) */}
        <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 min-w-0">
          <span title={mod.author} className="shrink-0">作者: {mod.author}</span>
          {mod.version && <span className="shrink-0">v{mod.version}</span>}
          {mod.gameVersion && (
            <span className="text-slate-500 shrink-0">游戏 {mod.gameVersion}</span>
          )}
          {mod.updatedAt && (
            <span className="text-slate-500 shrink-0">更新 {mod.updatedAt}</span>
          )}
          {viewMode === "detailed" && mod.dirPath && (
            <>
              <span className="flex-1 min-w-0" />
              <span className="text-[10px] text-slate-600 truncate min-w-0 max-w-[180px]" title={mod.dirPath}>
                {mod.dirPath}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigator.clipboard.writeText(mod.dirPath).catch(() => {});
                  message("目录路径已复制", { title: "复制", kind: "info" });
                }}
                title="复制目录路径"
                className="text-slate-600 hover:text-slate-300 cursor-pointer shrink-0 text-[10px]"
              >
                📋
              </button>
            </>
          )}
        </div>

        {viewMode === "detailed" && mod.description && (
          <p
            className="text-xs text-slate-500 mt-1.5 line-clamp-2"
            title={mod.description}
          >
            {renderColoredText(mod.description)}
          </p>
        )}

        {/* ★ v2: user note — 📝 block with add/edit entry */}
        {viewMode === "detailed" && (
          <div className="mt-1.5">
            {noteText ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNoteEditorOpen(true);
                }}
                className="w-full text-left text-[10px] px-2 py-1 rounded bg-amber-950/30
                           border border-amber-800/40 text-amber-200/80 hover:bg-amber-950/50
                           cursor-pointer transition-colors line-clamp-2"
                title={noteText}
              >
                📝 {noteText}
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setNoteEditorOpen(true);
                }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-slate-600
                           text-slate-500 hover:text-slate-300 hover:border-slate-400 cursor-pointer"
              >
                + 添加备注
              </button>
            )}
          </div>
        )}
      </div>

      {/* Right sidebar: toggle / order / actions */}
      <div className="flex flex-col items-center gap-3 shrink-0">
        {!hideToggleAndOrder && (
          <>
        {/* Enable toggle — hidden when hideToggle (collections: no enable semantics) */}
        {!hideToggle && (
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
        )}

        {/* Order controls — hidden when hideOrder (order lives in load-order view) */}
        {!hideOrder && (
        <div className="flex flex-col items-center gap-0.5">
          <button
            onClick={onOrderUp}
            title="提前一位（位置 -1）"
            className="text-slate-500 hover:text-slate-200 cursor-pointer transition-colors px-1 text-xs"
          >
            ▲
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={localOrder}
            onFocus={() => onOrderFocus?.()}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === "") {
                setLocalOrder(mod.order);
                return;
              }
              const stripped = raw.replace(/^0+/, "");
              const v = parseInt(stripped || "0", 10);
              if (isNaN(v)) {
                setLocalOrder(mod.order);
                return;
              }
              setLocalOrder(v);
            }}
            onBlur={() => {
              const floored = Math.floor(localOrder);
              if (floored < 0 || isNaN(floored)) {
                setLocalOrder(mod.order);
                return;
              }
              setLocalOrder(floored);
              if (floored !== mod.order) {
                onOrderChange?.(floored);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur();
            }}
            onClick={(e) => e.stopPropagation()}
            title="加载顺序（可直接输入）"
            className="w-11 text-center bg-slate-700 border border-slate-600 rounded text-slate-300 text-xs px-1 py-0.5
                       outline-none focus:border-blue-500 transition-colors select-text"
          />
          <button
            onClick={onOrderDown}
            title="延后一位（位置 +1）"
            className="text-slate-500 hover:text-slate-200 cursor-pointer transition-colors px-1 text-xs"
          >
            ▼
          </button>
        </div>
        )}
          </>
        )}

        {/* Open folder + Workshop link */}
        <div className="flex items-center gap-2">
          {mod.source === 1 && (
            <div className="relative group inline-flex items-center">
              <button
                onClick={(e) => e.stopPropagation()}
                className="text-[12px] text-slate-600 group-hover:invisible cursor-pointer transition-colors"
              >
                访问
              </button>
              <span className="absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openWorkshopUrl(mod.fileId).catch((e) => {
                      message(String(e), { title: "错误", kind: "error" });
                    });
                  }}
                  className="text-[12px] text-slate-600 hover:text-blue-400 cursor-pointer transition-colors"
                >
                  浏览器
                </button>
                <span className="text-slate-700">·</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    openSteamWorkshop(mod.fileId).catch((e) => {
                      message(String(e), { title: "错误", kind: "error" });
                    });
                  }}
                  className="text-[12px] text-slate-600 hover:text-blue-400 cursor-pointer transition-colors"
                >
                  创意工坊
                </button>
              </span>
            </div>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              openInExplorer(mod.dirPath).catch((e) => {
                message(String(e), { title: "错误", kind: "error" });
              });
            }}
            title="打开 Mod 所在文件夹"
            className="text-[12px] text-slate-600 hover:text-slate-400 cursor-pointer transition-colors"
          >
            打开目录
          </button>
        </div>
      </div>

      {/* ★ v2: category/note popups */}
      {catPickerOpen && (
        <CategoryPicker
          modKey={modKey}
          title={mod.title}
          onClose={() => setCatPickerOpen(false)}
        />
      )}
      {noteEditorOpen && (
        <NoteEditor
          modKey={modKey}
          title={mod.title}
          onClose={() => setNoteEditorOpen(false)}
        />
      )}
      {conflictOpen && conflicts && conflicts.length > 0 && (
        <ConflictDialog
          modKey={modKey}
          modTitle={mod.title}
          conflicts={conflicts}
          modTitles={modTitles ?? {}}
          onClose={() => setConflictOpen(false)}
        />
      )}
    </div>
  );
}
