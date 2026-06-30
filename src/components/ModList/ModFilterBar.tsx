import type { CategoryKey, EnabledFilter, ViewMode } from "./useModListState";
import { FILTER_CATEGORIES } from "./useModListState";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  enabledFilter: EnabledFilter;
  onCycleEnabledFilter: () => void;
  activeCategories: Set<CategoryKey>;
  onToggleCategory: (key: CategoryKey) => void;
  catDropdownOpen: boolean;
  onToggleCatDropdown: () => void;
  catDropdownRef: React.RefObject<HTMLDivElement | null>;
  activeTags: Set<string>;
  onToggleTag: (tag: string) => void;
  tagMode: "or" | "and";
  onSetTagMode: (mode: "or" | "and") => void;
  tagDropdownOpen: boolean;
  onToggleTagDropdown: () => void;
  tagDropdownRef: React.RefObject<HTMLDivElement | null>;
  allTags: string[];
  viewMode: ViewMode;
  onToggleViewMode: () => void;
  onApplyOrder: () => void;
  onGroupCreateMouseDown: (e: React.MouseEvent) => void;
}

export default function ModFilterBar({
  search,
  onSearchChange,
  enabledFilter,
  onCycleEnabledFilter,
  activeCategories,
  onToggleCategory,
  catDropdownOpen,
  onToggleCatDropdown,
  catDropdownRef,
  activeTags,
  onToggleTag,
  tagMode,
  onSetTagMode,
  tagDropdownOpen,
  onToggleTagDropdown,
  tagDropdownRef,
  allTags,
  viewMode,
  onToggleViewMode,
  onApplyOrder,
  onGroupCreateMouseDown,
}: Props) {
  const enabledLabel =
    enabledFilter === "all" ? "全部" : enabledFilter === "enabled" ? "已启用" : "已禁用";

  const enabledClass =
    enabledFilter === "all"
      ? "border-slate-500 text-slate-300 bg-slate-700"
      : enabledFilter === "enabled"
        ? "border-green-600 text-green-300 bg-green-900/40"
        : "border-amber-600 text-amber-300 bg-amber-900/40";

  return (
    <div className="shrink-0 px-6 py-2.5 border-b border-slate-700 bg-slate-800/50">
      <div className="flex items-center gap-2 flex-wrap">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索 Mod 名称、作者、描述..."
            className="w-full text-xs px-3 py-1.5 pl-7 bg-slate-800 border border-slate-600
                       rounded text-slate-200 outline-none focus:border-blue-500 transition-colors"
          />
          <svg
            className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Enabled toggle */}
        <button
          onClick={onCycleEnabledFilter}
          title="快速筛选：全部 / 已启用 / 已禁用"
          className={`text-xs px-2 py-1.5 rounded border cursor-pointer shrink-0 transition-colors ${enabledClass}`}
        >
          {enabledLabel}
        </button>

        {/* Category dropdown */}
        <div className="relative shrink-0" ref={catDropdownRef}>
          <button
            onClick={onToggleCatDropdown}
            className="text-xs px-2 py-1.5 border border-slate-600 rounded
                       text-slate-300 bg-slate-800 hover:border-slate-400
                       cursor-pointer transition-colors flex items-center gap-1"
          >
            分类
            <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {catDropdownOpen && (
            <div
              className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-30 bg-slate-800
                         border border-slate-600 rounded shadow-lg py-1 min-w-36"
            >
              {FILTER_CATEGORIES.map((cat) => {
                const checked = activeCategories.has(cat.key);
                return (
                  <label
                    key={cat.key}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300
                               hover:bg-slate-700 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleCategory(cat.key)}
                      className="accent-blue-500"
                    />
                    {cat.label}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Tag dropdown */}
        <div className="relative shrink-0" ref={tagDropdownRef}>
          <button
            onClick={onToggleTagDropdown}
            className={`text-xs px-2 py-1.5 border rounded text-slate-300
                       hover:border-slate-400 cursor-pointer transition-colors
                       flex items-center gap-1 ${
                         activeTags.size > 0
                           ? "border-blue-500 bg-blue-900/30"
                           : "border-slate-600 bg-slate-800"
                       }`}
          >
            标签
            {activeTags.size > 0 && (
              <span className="text-[10px] text-blue-300 ml-0.5">({activeTags.size})</span>
            )}
            <svg className="w-3 h-3 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {tagDropdownOpen && (
            <div
              className="absolute top-full mt-1 left-1/2 -translate-x-1/2 z-30 bg-slate-800
                         border border-slate-600 rounded shadow-lg py-1 max-h-60 overflow-y-auto min-w-44"
            >
              {allTags.length === 0 && (
                <p className="px-3 py-2 text-xs text-slate-500">暂无标签</p>
              )}
              {allTags.length > 0 && activeTags.size > 0 && (
                <div className="flex items-center gap-1 px-3 py-1 border-b border-slate-600 mb-1">
                  <span className="text-xs text-slate-500">匹配:</span>
                  <button
                    onClick={() => onSetTagMode("or")}
                    className={
                      "text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors " +
                      (tagMode === "or"
                        ? "bg-blue-600 text-white"
                        : "text-slate-400 hover:text-slate-200")
                    }
                  >
                    或(OR)
                  </button>
                  <button
                    onClick={() => onSetTagMode("and")}
                    className={
                      "text-xs px-1.5 py-0.5 rounded cursor-pointer transition-colors " +
                      (tagMode === "and"
                        ? "bg-amber-600 text-white"
                        : "text-slate-400 hover:text-slate-200")
                    }
                  >
                    与(AND)
                  </button>
                </div>
              )}
              {allTags.map((tag) => {
                const checked = activeTags.has(tag);
                return (
                  <label
                    key={tag}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-300
                               hover:bg-slate-700 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleTag(tag)}
                      className="accent-blue-500"
                    />
                    {tag}
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Apply order */}
        <button
          onClick={onApplyOrder}
          title="将当前列表中已启用Mod的顺序同步为加载顺序（从0递增）"
          className="text-xs px-2 py-1.5 border border-amber-600 rounded
                     text-amber-300 bg-amber-950/30 hover:bg-amber-900/40
                     cursor-pointer transition-colors shrink-0"
        >
          应用顺序
        </button>

        {/* View mode toggle */}
        <button
          onClick={onToggleViewMode}
          title={viewMode === "detailed" ? "切换到紧凑视图" : "切换到详细视图"}
          className="text-xs px-2 py-1.5 border border-slate-600 rounded
                     text-slate-300 bg-slate-800 hover:border-slate-400
                     cursor-pointer transition-colors shrink-0"
        >
          {viewMode === "detailed" ? "紧凑" : "详细"}
        </button>

        {/* New group */}
        <button
          onMouseDown={onGroupCreateMouseDown}
          className="text-xs px-2 py-1.5 border border-blue-700 rounded
                     text-blue-300 bg-blue-950/30 hover:bg-blue-900/40
                     cursor-pointer transition-colors shrink-0 select-none"
          title="按住拖拽到列表中创建分组"
        >
          + 分组
        </button>
      </div>
    </div>
  );
}
