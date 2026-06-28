import { createLogger } from "./lib/logger";
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import {
  validateGamePath,
  launchGame,
  launchGameSteam,
  checkGameRunning,
  killGame,
  writeModSettings,
  loadConfig,
  saveConfig,
  openLogDir,
} from "./lib/tauriApi";
import { collectModSettingsData, patchModSettingsLua, generateModSettingsLua } from "./utils/generateModSettings";
import { useAppStore } from "./store/useAppStore";
import { useModStore } from "./store/useModStore";
import { useModScanner } from "./hooks/useModScanner";
import type { ProfileData } from "./lib/types";
import ModList from "./components/ModList/ModList";
import SettingsEditor from "./components/SettingsEditor/SettingsEditor";
import ProfileManager from "./components/ProfileManager/ProfileManager";

const log = createLogger("App");

function App() {
  const gamePath = useAppStore((s) => s.gamePath);
  const detecting = useAppStore((s) => s.detecting);
  const error = useAppStore((s) => s.error);
  const setGamePath = useAppStore((s) => s.setGamePath);
  const setDetecting = useAppStore((s) => s.setDetecting);
  const setError = useAppStore((s) => s.setError);
  const clearPath = useAppStore((s) => s.clearPath);
  const lastMessage = useAppStore((s) => s.lastMessage);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const templateRaw = useAppStore((s) => s.templateRaw);

  const clearMods = useModStore((s) => s.clearMods);
  const selectedModKey = useModStore((s) => s.selectedModKey);
  const selectMod = useModStore((s) => s.selectMod);
  const mods = useModStore((s) => s.mods);
  const setMods = useModStore((s) => s.setMods);
  const updateModSettings = useModStore((s) => s.updateModSettings);
  const { scan, rescan } = useModScanner();

  const [gameRunning, setGameRunning] = useState(false);
  const [hoverButton, setHoverButton] = useState(false);
  const [hoverKill, setHoverKill] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-load cached game path on startup
  const [configLoaded, setConfigLoaded] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await loadConfig();
        const cfg = JSON.parse(raw);
        if (cfg.gamePath) {
          const result = await validateGamePath(cfg.gamePath);
          if (result.path) {
            setGamePath(result.path, "auto");
          }
        }
      } catch {
        // No valid cache, silent ignore
      } finally {
        setConfigLoaded(true);
      }
    })();
  }, [setGamePath]);

  // Auto-save config when game path changes (only after initial load)
  useEffect(() => {
    if (configLoaded && gamePath) {
      saveConfig(JSON.stringify({ gamePath })).catch(() => {});
    }
  }, [gamePath, configLoaded]);

  // Auto-scan mods when game path is confirmed
  useEffect(() => {
    if (gamePath) {
      scan(gamePath).then(() => {
        const count = useModStore.getState().mods.length;
        const enabled = useModStore.getState().mods.filter((m) => m.enabled).length;
        setLastMessage(`已加载 ${count} 个 Mod（${enabled} 个已启用）`);
      });
    }
  }, [gamePath, scan, setLastMessage]);

  // Listen for game-exited events from Rust backend (no polling needed)
  useEffect(() => {
    // Check initial state in case game was already running
    checkGameRunning().then((running) => {
      if (running) setGameRunning(true);
    });

    const p = listen("game-exited", () => {
      setGameRunning(false);
    });
    return () => {
      p.then((unlisten) => unlisten());
    };
  }, []);

  const handleLaunch = async () => {
    if (!gamePath || gameRunning) return;
    setLaunchError(null);
    try {
      await launchGame(gamePath);
      setGameRunning(true);
    } catch (e) {
      setLaunchError(`启动失败: ${String(e)}`);
    }
  };

  const handleLaunchSteam = async () => {
    if (gameRunning) return;
    setLaunchError(null);
    try {
      await launchGameSteam();
      setGameRunning(true);
    } catch (e) {
      setLaunchError(`Steam 启动失败: ${String(e)}`);
    }
  };

  const handleKill = async () => {
    try {
      await killGame();
      setGameRunning(false);
    } catch (e) {
      setLaunchError(`停止失败: ${String(e)}`);
    }
  };

  const enterHover = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setHoverButton(true);
  };
  const leaveHover = () => {
    hoverTimerRef.current = setTimeout(() => {
      setHoverButton(false);
    }, 200);
  };

  const handleSelectFolder = async () => {
    const selected = await open({
      directory: true,
      title: "选择《太吾绘卷》游戏根目录",
      multiple: false,
    });
    if (!selected) return;

    setDetecting(true);
    setError(null);
    try {
      const result = await validateGamePath(selected as string);
      if (result.path) {
        setGamePath(result.path, "manual");
      } else {
        setError(
          "所选目录中未找到 The Scroll of Taiwu.exe，请确认选择了正确的游戏根目录。"
        );
      }
    } catch (e) {
      setError(`验证失败: ${String(e)}`);
    } finally {
      setDetecting(false);
    }
  };

  const handleReselect = () => {
    clearMods();
    clearPath();
  };

  const handleRefresh = async () => {
    if (!gamePath || refreshing) return;
    setRefreshing(true);
    try {
      const { added, removed } = await rescan(gamePath);
      const parts: string[] = [];
      if (added > 0) parts.push(`${added} 个新增`);
      if (removed > 0) parts.push(`${removed} 个已移除`);
      if (parts.length > 0) {
        setLastMessage(`发现 ${parts.join("，")}`);
      } else {
        setLastMessage("Mod 列表已是最新");
      }
    } catch {
      setLastMessage("刷新失败");
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveAll = async () => {
    const currentMods = useModStore.getState().mods;
    const data = collectModSettingsData(currentMods);
    const lua = templateRaw
      ? patchModSettingsLua(templateRaw, data)
      : generateModSettingsLua(data);

    setLastMessage("保存中...");
    try {
      await writeModSettings(gamePath!, lua);
      setLastMessage("已保存 — 启用状态已同步到 ModSettings.Lua");
    } catch (e) {
      setLastMessage(`保存失败: ${String(e)}`);
    }
  };

  const handleProfileLoad = async (data: ProfileData) => {
    // Build lookup for enabled mods and order from profile
    const enabledSet = new Set(data.enabledMods);
    const orderMap = data.modOrder ?? {};
    const settingsMap = data.modSettings ?? {};

    const updated = mods.map((m) => {
      const key = `${m.source}_${m.fileId}`;
      return {
        ...m,
        enabled: enabledSet.has(key),
        order: orderMap[key] ?? m.order,
        currentSettings: settingsMap[key] ?? m.currentSettings,
      };
    });

    setMods(updated);

    // Restore groups if present
    if (data.version >= 1 && data.groups) {
      // Strip anchorBefore/anchorAfter from imported groups — card anchors
      // are meaningless on a different client with different displayOrder.
      const cleanedGroups = data.groups.map((g) => ({
        ...g,
        anchorBefore: undefined,
        anchorAfter: undefined,
      }));
      useAppStore.getState().setGroups(cleanedGroups);
      if (data.groupOrder) useAppStore.getState().setGroupOrder(data.groupOrder);
    }

    setLastMessage(`方案 "${data.name}" 已加载（${data.enabledMods.length} 个已启用）`);

    // Write back to ModSettings.Lua
    try {
      const data = collectModSettingsData(updated);
      const lua = templateRaw
        ? patchModSettingsLua(templateRaw, data)
        : generateModSettingsLua(data);
      await writeModSettings(gamePath!, lua);
    } catch (e) {
      log.error(`写回 ModSettings.Lua 失败: ${String(e)}`);
    }
  };

  const selectedMod = selectedModKey
    ? mods.find(
        (m) => `${m.source}_${m.fileId}` === selectedModKey
      ) ?? null
    : null;

  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100">
      {/* Title Bar — merged with toolbar items */}
      <header className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-700 bg-slate-800 shrink-0">
        {gamePath && (
          <>
            {/* Left group: path info */}
            <span className="text-green-400 text-xs font-medium shrink-0">游戏目录已确认</span>
            <span className="text-[11px] font-mono text-slate-400 truncate max-w-80 min-w-0">
              {gamePath}
            </span>
            <button
              onClick={handleReselect}
              className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400
                         text-slate-400 rounded transition-colors cursor-pointer shrink-0"
            >
              重新选择
            </button>

            {/* Spacer */}
            <div className="flex-1 min-w-0" />

            {/* Right group: actions + launch */}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400
                         text-slate-400 rounded transition-colors cursor-pointer shrink-0
                         disabled:opacity-50"
            >
              {refreshing ? "刷新中..." : "刷新"}
            </button>
            <ProfileManager
              gamePath={gamePath}
              mods={mods}
              onLoad={handleProfileLoad}
            />
            <button
              onClick={() => openLogDir().catch(() => {})}
              title="打开日志目录"
              className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400
                         text-slate-400 rounded transition-colors cursor-pointer shrink-0"
            >
              日志
            </button>
            <button
              onClick={handleSaveAll}
              className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400
                         text-slate-400 rounded transition-colors cursor-pointer shrink-0"
            >
              同步
            </button>
            {lastMessage && (
              <span className="text-xs text-slate-500 truncate max-w-48 shrink">
                {lastMessage}
              </span>
            )}
            {/* Launch / Kill button */}
            <div
              className="relative shrink-0"
              onMouseEnter={enterHover}
              onMouseLeave={leaveHover}
            >
              {!gameRunning ? (
                hoverButton ? (
                  <div className="flex items-stretch">
                    <button
                      onClick={handleLaunch}
                      className="text-xs px-3 py-1 rounded-l bg-green-600 hover:bg-green-500
                                 text-white font-medium transition-colors cursor-pointer"
                    >
                      本地启动
                    </button>
                    <div className="w-px bg-green-700" />
                    <button
                      onClick={handleLaunchSteam}
                      className="text-xs px-3 py-1 rounded-r bg-blue-600 hover:bg-blue-500
                                 text-white font-medium transition-colors cursor-pointer"
                    >
                      Steam 启动
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleLaunch}
                    className="text-xs px-4 py-1 rounded bg-green-600 hover:bg-green-500
                               text-white font-medium transition-colors cursor-pointer"
                  >
                    启动游戏
                  </button>
                )
              ) : (
                <button
                  onClick={handleKill}
                  onMouseEnter={() => setHoverKill(true)}
                  onMouseLeave={() => setHoverKill(false)}
                  className={`text-xs px-4 py-1 rounded font-medium transition-colors cursor-pointer ${
                    hoverKill
                      ? "bg-red-600 hover:bg-red-500 text-white"
                      : "bg-amber-600 text-white"
                  }`}
                >
                  {hoverKill ? "停止游戏" : "游戏运行中"}
                </button>
              )}
            </div>
          </>
        )}
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {!gamePath ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
            {!configLoaded ? (
              <p className="text-sm text-slate-500">加载配置中...</p>
            ) : (
              <div className="flex flex-col items-center gap-5">
                <div className="text-center">
                  <p className="text-xl font-medium text-slate-200 mb-1">
                    欢迎使用太吾Mod启动器
                  </p>
                  <p className="text-sm text-slate-400">
                    请先选择《太吾绘卷》的游戏根目录
                  </p>
                </div>

                <button
                  onClick={handleSelectFolder}
                  disabled={detecting}
                  className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800
                             text-white rounded-lg font-medium transition-colors cursor-pointer
                             min-w-56 mt-2"
                >
                  {detecting ? "验证中..." : "选择游戏目录"}
                </button>

                {error && (
                  <p className="text-sm text-red-400 max-w-md text-center mt-1">
                    {error}
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            {launchError && (
              <div className="px-6 py-2 bg-red-900/40 border-b border-red-800 text-xs text-red-300 shrink-0">
                {launchError}
              </div>
            )}

            {/* Mod list — kept mounted to preserve scroll position */}
            <div
              className={`flex-1 flex flex-col overflow-hidden ${
                selectedMod ? "hidden" : ""
              }`}
            >
              <ModList
                gamePath={gamePath}
                onSelectMod={(key) => selectMod(key)}
              />
            </div>

            {/* Settings editor — overlaid when a mod is selected */}
            {selectedMod && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <SettingsEditor
                  mod={selectedMod}
                  onClose={() => selectMod(null)}
                  onSettingsSaved={(settings) =>
                    updateModSettings(selectedModKey!, settings)
                  }
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* Status Bar */}
      <footer className="flex items-center px-4 py-1.5 border-t border-slate-700 bg-slate-800 shrink-0 text-xs text-slate-500">
        <span>
          {gamePath ? "游戏路径已就绪" : "等待选择游戏路径"}
        </span>
        {gameRunning && (
          <span className="ml-auto text-amber-400">
            游戏运行中
          </span>
        )}
        {detecting && (
          <span className="ml-auto text-blue-400">正在验证...</span>
        )}
      </footer>
    </div>
  );
}

export default App;
