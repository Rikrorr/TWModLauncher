import { useCallback, useMemo, useState } from "react";
import { writeSettingsFile } from "../../lib/tauriApi";
import type { ModInfo } from "../../lib/types";
import SettingField from "./SettingField";

interface Props {
  mod: ModInfo;
  onClose: () => void;
  onSettingsSaved: (settings: Record<string, unknown>) => void;
}

/** Generate Settings.Lua text from a values map */
function generateSettingsLua(values: Record<string, unknown>): string {
  const lines = ["return {"];
  for (const [k, v] of Object.entries(values)) {
    lines.push(`\t${k} = ${luaValue(v)},`);
  }
  lines.push("}");
  lines.push(""); // trailing newline
  return lines.join("\n");
}

function luaValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return `"${v}"`;
  return "nil";
}

export default function SettingsEditor({ mod, onClose, onSettingsSaved }: Props) {
  // Local mutable copy of current settings
  const [values, setValues] = useState<Record<string, unknown>>(() => ({
    ...mod.currentSettings,
  }));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    // Default to first group
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

  const handleChange = useCallback((key: string, newValue: unknown) => {
    setValues((prev) => ({ ...prev, [key]: newValue }));
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const raw = generateSettingsLua(values);
      await writeSettingsFile(mod.dirPath, raw);
      // Sync saved values back to Zustand so re-opening shows current state
      onSettingsSaved(values);
    } catch (e) {
      setSaveError(`保存失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [values, mod.dirPath, onSettingsSaved]);

  const changedCount = useMemo(() => {
    let count = 0;
    for (const [k, v] of Object.entries(values)) {
      if (mod.currentSettings[k] !== v) count++;
    }
    return count;
  }, [values, mod.currentSettings]);

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-700 bg-slate-800 shrink-0">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100 truncate">
            {mod.title}
          </h2>
          <p className="text-xs text-slate-500 truncate">{mod.author}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-3">
          {changedCount > 0 && (
            <span className="text-xs text-amber-400">
              {changedCount} 项已修改
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || changedCount === 0}
            className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-slate-700
                       text-white rounded font-medium transition-colors cursor-pointer
                       disabled:cursor-not-allowed disabled:text-slate-500"
          >
            {saving ? "保存中..." : "保存"}
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs border border-slate-600 hover:border-slate-400
                       text-slate-400 rounded transition-colors cursor-pointer"
          >
            关闭
          </button>
        </div>
      </div>

      {saveError && (
        <div className="px-5 py-2 bg-red-900/40 border-b border-red-800 text-xs text-red-300">
          {saveError}
        </div>
      )}

      {/* Body: group nav + settings */}
      <div className="flex-1 flex overflow-hidden">
        {/* Group navigation */}
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

        {/* Settings panel */}
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
