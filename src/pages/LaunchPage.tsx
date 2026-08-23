import { useState, useEffect, useRef } from "react";
import { listProfiles } from "../lib/tauriApi";
import { useAppStore } from "../store/useAppStore";
import type { ModInfo, ModMeta, ProfileData, ProfileDataV1, ProfileMeta } from "../lib/types";
import { detectMissingMods, isProfileV2, migrateProfileV1 } from "../utils/migrateProfile";
import { createLogger } from "../lib/logger";
import MissingModsDialog from "../components/ProfileManager/MissingModsDialog";

interface Props {
  mods: ModInfo[];
  gamePath: string | null;
  gameRunning: boolean;
  launchError: string | null;
  onActivateScheme: (data: ProfileData) => void;
  onLaunchLocal: () => void;
  onLaunchSteam: () => void;
  onKill: () => void;
  onGoSettings: () => void;
}

const log = createLogger("LaunchPage");

/** Portal page — game background, scheme selection, launch button. */
export default function LaunchPage({
  mods,
  gamePath,
  gameRunning,
  launchError,
  onActivateScheme,
  onLaunchLocal,
  onLaunchSteam,
  onKill,
  onGoSettings,
}: Props) {
  const activeSchemeName = useAppStore((s) => s.activeSchemeName);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [profiles, setProfiles] = useState<ProfileMeta[]>([]);
  const [missingMods, setMissingMods] = useState<Map<string, ModMeta> | null>(null);
  const [pendingActivate, setPendingActivate] = useState<ProfileData | null>(null);
  const [hoverButtons, setHoverButtons] = useState(false);
  const [hoverKill, setHoverKill] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const refresh = async () => {
    try {
      setProfiles(await listProfiles());
    } catch (e) {
      log.error(`listProfiles failed: ${String(e)}`);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => {
      void refresh();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  // Close scheme dropdown on outside click / Escape
  useEffect(() => {
    if (!schemeOpen) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setSchemeOpen(false);
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSchemeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [schemeOpen]);

  const handleActivate = async (name: string) => {
    setSchemeOpen(false);
    try {
      const { loadProfile } = await import("../lib/tauriApi");
      const raw = await loadProfile(name);
      let parsed: ProfileData | ProfileDataV1;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return;
      }
      const data: ProfileData = isProfileV2(parsed)
        ? (parsed as ProfileData)
        : (() => {
            void import("../lib/tauriApi").then(({ saveProfile }) =>
              saveProfile(`${name}.bak-v1`, raw).catch(() => {}),
            );
            return migrateProfileV1(parsed as ProfileDataV1);
          })();
      const missing = detectMissingMods(data, mods);
      if (missing.size > 0) {
        setPendingActivate(data);
        setMissingMods(missing);
        return;
      }
      onActivateScheme(data);
    } catch (e) {
      log.error(`activate ${name} failed: ${String(e)}`);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      {/* Background */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900"
        aria-hidden
      />
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, #3b82f6 0, transparent 40%), radial-gradient(circle at 80% 70%, #22c55e 0, transparent 40%)",
        }}
        aria-hidden
      />

      <div className="relative flex-1 flex flex-col items-center justify-center gap-8 p-8">
        {/* Title */}
        <div className="text-center">
          <h1 className="text-3xl font-bold text-slate-100 tracking-wider">
            太吾 Mod 启动器
          </h1>
          <p className="text-sm text-slate-400 mt-2">
            The Scroll of Taiwu · Mod Launcher
          </p>
        </div>

        {/* Path guidance */}
        {!gamePath && (
          <div className="flex flex-col items-center gap-2">
            <p className="text-sm text-slate-400">
              尚未配置游戏路径
            </p>
            <button
              onClick={onGoSettings}
              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
            >
              前往设置
            </button>
          </div>
        )}

        {gamePath && (
          <>
            {/* Scheme selection */}
            <div className="relative" ref={ref}>
              <button
                onClick={() => setSchemeOpen((v) => !v)}
                className="min-w-64 text-sm px-4 py-2.5 bg-slate-800/80 border border-slate-600
                           hover:border-blue-500 rounded-lg text-slate-200
                           cursor-pointer transition-colors flex items-center justify-between gap-3"
              >
                <span className="truncate">
                  {activeSchemeName ? `方案: ${activeSchemeName}` : "方案: 未选择"}
                </span>
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {schemeOpen && (
                <div className="absolute top-full mt-1 left-0 right-0 bg-slate-800 border border-slate-600
                                rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
                  {profiles.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-3">暂无方案，请到方案页创建</p>
                  ) : (
                    profiles.map((p) => {
                      const isActive = activeSchemeName === p.name;
                      return (
                        <button
                          key={p.name}
                          onClick={() => handleActivate(p.name)}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2 ${
                            isActive ? "bg-blue-900/40 text-blue-300" : "text-slate-200 hover:bg-slate-700/70"
                          }`}
                        >
                          <span className="flex-1 truncate">{isActive ? "● " : ""}{p.name}</span>
                          <span className="text-xs text-slate-500 shrink-0">{p.modCount} Mod</span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {/* Launch / kill */}
            <div className="flex flex-col items-center gap-2">
              {!gameRunning ? (
                <div
                  className="relative"
                  onMouseEnter={() => setHoverButtons(true)}
                  onMouseLeave={() => setHoverButtons(false)}
                >
                  {hoverButtons ? (
                    <div className="flex items-stretch">
                      <button
                        onClick={onLaunchLocal}
                        className="px-8 py-3 rounded-l-lg bg-green-600 hover:bg-green-500 text-white
                                   font-medium text-base cursor-pointer transition-colors"
                      >
                        本地启动
                      </button>
                      <div className="w-px bg-green-700" />
                      <button
                        onClick={onLaunchSteam}
                        className="px-8 py-3 rounded-r-lg bg-blue-600 hover:bg-blue-500 text-white
                                   font-medium text-base cursor-pointer transition-colors"
                      >
                        Steam 启动
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={onLaunchLocal}
                      className="px-12 py-3 rounded-lg bg-green-600 hover:bg-green-500 text-white
                                 font-medium text-lg cursor-pointer transition-colors shadow-lg
                                 shadow-green-900/40"
                    >
                      启动游戏
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={onKill}
                    onMouseEnter={() => setHoverKill(true)}
                    onMouseLeave={() => setHoverKill(false)}
                    className={`px-12 py-3 rounded-lg font-medium text-lg cursor-pointer transition-colors ${
                      hoverKill ? "bg-red-600 hover:bg-red-500 text-white" : "bg-amber-600 text-white"
                    }`}
                  >
                    {hoverKill ? "停止游戏" : "游戏运行中"}
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* Launch error */}
        {launchError && (
          <p className="text-sm text-red-400 max-w-md text-center">{launchError}</p>
        )}
      </div>

      {missingMods && (
        <MissingModsDialog
          missing={missingMods}
          onClose={() => {
            setMissingMods(null);
            if (pendingActivate) {
              onActivateScheme(pendingActivate);
              setPendingActivate(null);
            }
          }}
        />
      )}
    </div>
  );
}
