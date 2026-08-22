import { useEffect, useRef, useState } from "react";
import { listProfiles, loadProfile } from "../../lib/tauriApi";
import { useAppStore } from "../../store/useAppStore";
import type { ModInfo, ModMeta, ProfileData, ProfileDataV1, ProfileMeta } from "../../lib/types";
import { detectMissingMods, isProfileV2, migrateProfileV1 } from "../../utils/migrateProfile";
import { createLogger } from "../../lib/logger";
import MissingModsDialog from "./MissingModsDialog";

interface Props {
  mods: ModInfo[];
  /** Activate a scheme (write to disk + set active state) */
  onActivate: (data: ProfileData) => void;
  /** Open the scheme editing panel (ProfileManager) */
  onOpenManager: () => void;
  /** Create a new empty scheme and open the manager for naming */
  onCreateScheme: () => void;
}

const log = createLogger("SchemeSelector");

/** Toolbar scheme switcher — high-frequency activate/switch, separate from editing. */
export default function SchemeSelector({ mods, onActivate, onOpenManager, onCreateScheme }: Props) {
  const activeSchemeName = useAppStore((s) => s.activeSchemeName);
  const [open, setOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [missingMods, setMissingMods] = useState<Map<string, ModMeta> | null>(null);
  const [pendingActivate, setPendingActivate] = useState<ProfileData | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      setProfiles(await listProfiles());
    } catch (e) {
      log.error(`listProfiles failed: ${String(e)}`);
    }
  };

  useEffect(() => {
    if (open) {
      // Refresh list on open — defer to avoid sync setState in effect
      const t = setTimeout(() => {
        void refresh();
      }, 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [open]);

  const handleActivate = async (name: string) => {
    setOpen(false);
    try {
      const raw = await loadProfile(name);
      let parsed: ProfileData | ProfileDataV1;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      // v1 → v2 migration with backup (same policy as ProfileManager)
      const data: ProfileData = isProfileV2(parsed)
        ? (parsed as ProfileData)
        : (() => {
            saveBackup(name, raw);
            return migrateProfileV1(parsed as ProfileDataV1);
          })();

      const missing = detectMissingMods(data, mods);
      if (missing.size > 0) {
        setPendingActivate(data);
        setMissingMods(missing);
        return;
      }
      onActivate(data);
    } catch (e) {
      log.error(`activate ${name} failed: ${String(e)}`);
    }
  };

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="切换当前启动方案"
        className={`text-xs px-2.5 py-1 border rounded transition-colors cursor-pointer
                   flex items-center gap-1 ${
                     activeSchemeName
                       ? "border-blue-600 bg-blue-900/30 text-blue-300 hover:border-blue-400"
                       : "border-slate-600 text-slate-400 hover:border-slate-400"
                   }`}
      >
        <span className="max-w-28 truncate">
          {activeSchemeName ? `方案: ${activeSchemeName}` : "方案: 未选择"}
        </span>
        <svg className="w-3 h-3 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-60 bg-slate-800 border border-slate-600
                        rounded-lg shadow-xl z-50 py-1">
          <div className="px-3 py-1.5 text-[10px] text-slate-500 border-b border-slate-700">
            选择要启动的方案（立即写入 ModSettings.Lua）
          </div>
          <div className="max-h-56 overflow-y-auto">
            {profiles.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-3">暂无方案</p>
            ) : (
              profiles.map((p) => {
                const isActive = activeSchemeName === p.name;
                return (
                  <button
                    key={p.name}
                    onClick={() => handleActivate(p.name)}
                    className={`w-full text-left px-3 py-1.5 text-xs transition-colors
                               flex items-center gap-2 ${
                                 isActive
                                   ? "bg-blue-900/40 text-blue-300"
                                   : "text-slate-200 hover:bg-slate-700/70"
                               }`}
                  >
                    <span className="flex-1 truncate">
                      {isActive ? "● " : ""}{p.name}
                    </span>
                    <span className="text-slate-500 shrink-0">{p.modCount} Mod</span>
                  </button>
                );
              })
            )}
          </div>
          <div className="border-t border-slate-700 mt-1 pt-1 flex">
            <button
              onClick={() => {
                setOpen(false);
                onCreateScheme();
              }}
              className="flex-1 text-left px-3 py-1.5 text-xs text-blue-400 hover:bg-slate-700/70 transition-colors"
            >
              + 新建方案
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onOpenManager();
              }}
              className="flex-1 text-left px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-700/70 transition-colors"
            >
              方案管理…
            </button>
          </div>
        </div>
      )}

      {missingMods && (
        <MissingModsDialog
          missing={missingMods}
          onClose={() => {
            setMissingMods(null);
            if (pendingActivate) {
              onActivate(pendingActivate);
              setPendingActivate(null);
            }
          }}
        />
      )}
    </div>
  );
}

/** Best-effort backup of a v1 profile before in-place migration. */
async function saveBackup(name: string, raw: string): Promise<void> {
  try {
    const { saveProfile } = await import("../../lib/tauriApi");
    await saveProfile(`${name}.bak-v1`, raw);
  } catch {
    // non-fatal
  }
}
