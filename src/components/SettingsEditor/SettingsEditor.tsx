import { useCallback, useMemo, useState } from "react";
import type { ModInfo } from "../../lib/types";
import SettingField from "./SettingField";

interface Props {
  mod: ModInfo;
  onClose: () => void;
  onSettingsSaved: (settings: Record<string, unknown>) => void;
}

export default function SettingsEditor({ mod, onClose, onSettingsSaved }: Props) {
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...mod.currentSettings,
  }));
  const [activeGroup, setActiveGroup] = useState<string>("");

  // Build group list from settings definitions
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of mod.defaultSettings) {
      const g = s.groupName || "其他";
      if (!seen.has(g)) {
        seen.add(g);
        result.push(g);
      }
    }
    if (result.length > 0 && !activeGroup) {
      setActiveGroup(result[0]);
    }
    return result;
  }, [mod.defaultSettings, activeGroup]);

  const filteredSettings = useMemo(
    () =>
      mod.defaultSettings.filter(
        (s) => (s.groupName || "其他") === activeGroup,
      ),
    [mod.defaultSettings, activeGroup],
  );

  // Each change immediately commits to Zustand so the main toolbar
  // always sees the full dirty state across all mods + mod-list changes.
  const handleChange = useCallback(
    (key: string, newValue: unknown) => {
      setValues((prev) => {
        const next = { ...prev, [key]: newValue };
        onSettingsSaved(next);
        return next;
      });
    },
    [onSettingsSaved],
  );

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-800 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100 truncate">
            {mod.title}
          </h2>
          <p className="text-xs text-slate-500 truncate">
            {mod.author}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs border border-slate-600 hover:border-slate-400
                       text-slate-400 rounded transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>

      {/* Body: group nav + settings */}
      <div className="flex-1 flex overflow-hidden">
        <nav className="w-36 shrink-0 overflow-y-auto border-r border-slate-700 bg-slate-800/50 py-2">
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setActiveGroup(g)}
              className={`block w-full text-left px-3 py-1.5 text-xs transition-colors cursor-pointer ${
                activeGroup === g
                  ? "bg-blue-600/30 text-blue-300 border-r-2 border-blue-500"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-700/50"
              }`}
            >
              {g}
            </button>
          ))}
        </nav>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {filteredSettings.length === 0 ? (
            <p className="text-sm text-slate-500 py-4">此分组暂无设置项</p>
          ) : (
            filteredSettings.map((s) => (
              <SettingField
                key={s.key}
                setting={s}
                value={
                  values[s.key] !== undefined
                    ? values[s.key]
                    : s.defaultValue
                }
                onChange={handleChange}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
