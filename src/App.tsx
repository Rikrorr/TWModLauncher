import { useCallback, useEffect, useRef, useState } from "react";
import { open, ask } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  validateGamePath,
  launchGame,
  launchGameSteam,
  checkGameRunning,
  killGame,
  writeModSettings,
  writeSettingsFile,
  loadConfig,
  saveConfig,
  openLogDir,
  saveProfile,
} from "./lib/tauriApi";
import { collectModSettingsData, patchModSettingsLua, generateModSettingsLua, generateSettingsLua } from "./utils/generateModSettings";
import { useAppStore } from "./store/useAppStore";
import { useModStore } from "./store/useModStore";
import { useCategoryStore } from "./store/useCategoryStore";
import { useNoteStore } from "./store/useNoteStore";
import { useModScanner } from "./hooks/useModScanner";
import { useCollectionStore } from "./store/useCollectionStore";
import type { ProfileData } from "./lib/types";
import ModList from "./components/ModList/ModList";
import SettingsEditor from "./components/SettingsEditor/SettingsEditor";
import ProfileManager from "./components/ProfileManager/ProfileManager";
import CollectionPanel from "./components/Collection/CollectionPanel";

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
  const isDirty = useAppStore((s) => s.isDirty);
  const setDirty = useAppStore((s) => s.setDirty);
  const addDirtyModSetting = useAppStore((s) => s.addDirtyModSetting);

  const clearMods = useModStore((s) => s.clearMods);
  const selectedModKey = useModStore((s) => s.selectedModKey);
  const selectMod = useModStore((s) => s.selectMod);
  const mods = useModStore((s) => s.mods);
  const setMods = useModStore((s) => s.setMods);
  const updateModSettings = useModStore((s) => s.updateModSettings);
  const { scan, rescan } = useModScanner();

  // ★ v2: hydrate global category/note stores on startup
  useEffect(() => {
    useCategoryStore.getState().hydrate();
    useNoteStore.getState().hydrate();
  }, []);

  const [gameRunning, setGameRunning] = useState(false);
  const [hoverButton, setHoverButton] = useState(false);
  const [hoverKill, setHoverKill] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionCreateSeed, setCollectionCreateSeed] = useState<{ modKeys: string[]; modMeta: Record<string, import("./lib/types").ModMeta> } | null>(null);
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
          } else {
            setLastMessage("缓存的游戏路径已失效，请重新选择游戏目录");
          }
        }
      } catch {
        // No valid cache, silent ignore
      } finally {
        setConfigLoaded(true);
      }
    })();
  }, [setGamePath, setLastMessage]);

  // Auto-save config when game path changes (only after initial load)
  useEffect(() => {
    if (configLoaded && gamePath) {
      saveConfig(JSON.stringify({ gamePath })).catch(() => {});
    }
  }, [gamePath, configLoaded]);

  // Auto-scan mods when game path is confirmed
  useEffect(() => {
    if (gamePath) {
      scan(gamePath).then((meta) => {
        if (!meta) return;
        setDirty(false);
        const parts = [`已加载 ${meta.total} 个 Mod（${meta.enabled} 个已启用）`];
        if (meta.failedCount > 0) {
          const names = meta.failedModNames.slice(0, 3).join("、");
          const suffix = meta.failedModNames.length > 3 ? `等${meta.failedModNames.length}个` : "";
          parts.push(`${meta.failedCount} 个解析失败（${names}${suffix}）`);
        }
        if (meta.msParseFailed) {
          parts.push("ModSettings.Lua 解析失败，启用状态可能不准确");
        }
        if (meta.warnings.length > 0) {
          parts.push(...meta.warnings);
        }
        setLastMessage(parts.join("，"));
      });
    }
  }, [gamePath, scan, setLastMessage, setDirty]);

  // Listen for game-exited events from Rust backend (no polling needed)
  useEffect(() => {
    // Check initial state in case game was already running
    checkGameRunning().then((running) => {
      if (running) setGameRunning(true);
    });

    const p = listen("game-exited", () => {
      setGameRunning(false);
    });
    const p2 = listen<string>("game-launch-failed", (event) => {
      setGameRunning(false);
      setLaunchError(event.payload);
    });
    return () => {
      p.then((unlisten) => unlisten());
      p2.then((unlisten) => unlisten());
    };
  }, []);

  // Warn before closing if there are unsaved changes
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let closing = false; // guard against destroy() re-triggering onCloseRequested
    getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) return;
      if (useAppStore.getState().isDirty) {
        event.preventDefault();
        const confirmed = await ask(
          "有未保存的更改，确定要退出程序吗？",
          { title: "未保存的更改", kind: "warning" },
        );
        if (confirmed) {
          closing = true;
          useAppStore.getState().setDirty(false);
          await getCurrentWindow().destroy();
        }
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const handleLaunch = async () => {
    if (!gamePath || gameRunning) return;
    setLaunchError(null);
    // ★ v2: safety gate — auto-sync unsaved changes before launching
    if (useAppStore.getState().isDirty) {
      setLastMessage("检测到未保存的更改，先同步再启动...");
      await handleSaveAll();
    }
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
    // ★ v2: safety gate — auto-sync unsaved changes before launching
    if (useAppStore.getState().isDirty) {
      setLastMessage("检测到未保存的更改，先同步再启动...");
      await handleSaveAll();
    }
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
      const msg = String(e);
      if (msg.includes("PERMISSION_DENIED")) {
        setError("所选目录无读取权限，请选择其他目录或检查权限设置。");
      } else if (msg.includes("PATH_NOT_FOUND")) {
        setError("所选目录不可用，可能磁盘已断开或目录已删除，请重新选择。");
      } else if (msg.includes("NOT_A_DIRECTORY")) {
        setError("所选路径不是有效的目录，请重新选择。");
      } else {
        setError(`验证失败: ${msg}`);
      }
    } finally {
      setDetecting(false);
    }
  };

  const handleReselect = async () => {
    if (useAppStore.getState().isDirty) {
      const confirmed = await ask(
        "有未保存的更改，确定要放弃并重新选择游戏目录吗？",
        { title: "未保存的更改", kind: "warning" },
      );
      if (!confirmed) return;
    }
    clearMods();
    clearPath();
    setDirty(false);
  };

  const handleRefresh = async () => {
    if (!gamePath || refreshing) return;

    // Warn if there are unsaved changes
    if (useAppStore.getState().isDirty) {
      const confirmed = await ask(
        "刷新将丢弃未保存的更改，确定继续吗？",
        { title: "未保存的更改", kind: "warning" },
      );
      if (!confirmed) return;
    }

    setRefreshing(true);
    const result = await rescan(gamePath);

    if (!result) {
      // Fatal error — likely path is invalid
      setRefreshing(false);
      setLastMessage("刷新失败，请检查游戏目录是否可用");
      try {
        await validateGamePath(gamePath);
        // Path is still valid but scan failed — don't redirect
      } catch {
        clearMods();
        clearPath();
        setDirty(false);
        setLastMessage("游戏目录不可用，请重新选择");
      }
      return;
    }

    const { added, removed, failedCount, msParseFailed, warnings, failedModNames } = result;
    setDirty(false);
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} 个新增`);
    if (removed > 0) parts.push(`${removed} 个已移除`);
    if (parts.length === 0) parts.push("Mod 列表已是最新");
    if (failedCount > 0) {
      const names = failedModNames.slice(0, 3).join("、");
      const suffix = failedModNames.length > 3 ? `等${failedModNames.length}个` : "";
      parts.push(`${failedCount} 个解析失败（${names}${suffix}）`);
    }
    if (msParseFailed) parts.push("ModSettings.Lua 解析失败");
    if (warnings.length > 0) parts.push(...warnings);
    setLastMessage(parts.join("，"));

    // If all known mods vanished, validate that the game directory still exists
    if (removed > 0 && useModStore.getState().mods.length === 0) {
      try {
        await validateGamePath(gamePath);
      } catch {
        clearMods();
        clearPath();
        setDirty(false);
        setLastMessage("游戏目录不可用，所有 Mod 已移除，请重新选择");
        setRefreshing(false);
        return;
      }
    }

    setRefreshing(false);
  };

  const handleSaveAll = useCallback(async () => {
    if (saving || !gamePath) return;
    const currentMods = useModStore.getState().mods;
    const data = collectModSettingsData(currentMods);
    const lua = templateRaw
      ? patchModSettingsLua(templateRaw, data)
      : generateModSettingsLua(data);

    setSaving(true);
    setLastMessage("保存中...");
    try {
      await writeModSettings(gamePath, lua);

      // Write per-mod Settings.Lua for mods with unsaved config changes
      const dirtyKeys = useAppStore.getState().dirtyModSettings;
      let perModMsg = "";
      if (dirtyKeys.length > 0) {
        const allMods = useModStore.getState().mods;
        const failedMods: string[] = [];
        const succeededKeys: string[] = [];
        for (const key of dirtyKeys) {
          const mod = allMods.find((m) => `${m.source}_${m.fileId}` === key);
          if (mod && mod.dirPath) {
            try {
              const raw = generateSettingsLua(mod.currentSettings);
              await writeSettingsFile(mod.dirPath, raw);
              succeededKeys.push(key);
            } catch (e) {
              failedMods.push(mod.title);
            }
          }
        }
        if (succeededKeys.length > 0) {
          useAppStore.getState().removeDirtyModSettings(succeededKeys);
        }
        if (failedMods.length > 0) {
          const names = failedMods.slice(0, 3).join("、");
          const suffix = failedMods.length > 3 ? `等${failedMods.length}个` : "";
          perModMsg = `，但 ${names}${suffix} 配置保存失败`;
        }
      }

      setDirty(false);
      setLastMessage(`已保存 — 启用状态已同步到 ModSettings.Lua${perModMsg}`);
    } catch (e) {
      setLastMessage(`保存失败: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  }, [gamePath, templateRaw, saving, setLastMessage, setDirty]);

  const handleProfileLoad = async (data: ProfileData) => {
    // ★ v2: member whitelist — scheme-outside mods are forced disabled
    const memberSet = new Set(data.modKeys ?? []);
    const enabledSet = new Set(data.enabledMods);
    const orderMap = data.modOrder ?? {};
    const settingsMap = data.modSettings ?? {};

    const updated = mods.map((m) => {
      const key = `${m.source}_${m.fileId}`;
      const inScheme = memberSet.has(key);
      return {
        ...m,
        enabled: inScheme && enabledSet.has(key),
        order: inScheme ? (orderMap[key] ?? m.order) : 0,
        currentSettings: inScheme ? (settingsMap[key] ?? m.currentSettings) : m.currentSettings,
      };
    });

    setMods(updated);

    // ★ v2: merge scheme-carried categories/notes into global stores (scheme wins)
    if (data.modCategories && Object.keys(data.modCategories).length > 0) {
      const catState = useCategoryStore.getState();
      const merged = { ...catState.modCats, ...data.modCategories };
      useCategoryStore.setState({ modCats: merged });
    }
    if (data.modNotes && Object.keys(data.modNotes).length > 0) {
      const noteState = useNoteStore.getState();
      const merged = { ...noteState.notes, ...data.modNotes };
      useNoteStore.setState({ notes: merged });
    }

    // Restore groups and displayOrder if present
    if (data.version >= 1 && data.groups) {
      useAppStore.getState().setGroups(data.groups);

      // Restore unified displayOrder from profile
      try {
        const raw = localStorage.getItem("twm-filter-prefs");
        const prefs = raw ? JSON.parse(raw) : {};
        if (data.displayOrder && data.displayOrder.length > 0) {
          prefs.displayOrder = data.displayOrder;
        } else if (data.groupOrder) {
          // Legacy: merge old groupOrder into displayOrder
          const order: string[] = prefs.displayOrder ?? [];
          const cleaned = order.filter((k: string) => !data.groups.some((g) => g.id === k));
          for (const gid of data.groupOrder) {
            if (!cleaned.includes(gid)) cleaned.push(gid);
          }
          prefs.displayOrder = cleaned;
        }
        localStorage.setItem("twm-filter-prefs", JSON.stringify(prefs));
      } catch { /* ignore */ }
    }

    // ★ v2: activating a scheme writes to disk immediately (decision A1)
    useAppStore.getState().setActiveSchemeName(data.name);
    useAppStore.getState().setActiveSchemeModKeys(data.modKeys ?? []);
    setLastMessage(`方案 "${data.name}" 已激活，正在同步...`);
    const activePath = useAppStore.getState().gamePath;
    if (!activePath) {
      setLastMessage(`方案 "${data.name}" 已激活（未检测到游戏路径，未同步）`);
      return;
    }
    try {
      const currentMods = useModStore.getState().mods;
      const sd = collectModSettingsData(currentMods);
      const lua = templateRaw
        ? patchModSettingsLua(templateRaw, sd)
        : generateModSettingsLua(sd);
      await writeModSettings(activePath, lua);
      useAppStore.getState().setDirty(false);
      setLastMessage(`方案 "${data.name}" 已激活并同步`);
    } catch (e) {
      setLastMessage(`方案 "${data.name}" 激活失败（同步写入错误）: ${String(e)}`);
    }
  };

  const handleSelectMod = useCallback(async (key: string) => {
    if (useAppStore.getState().isDirty) {
      await handleSaveAll();
    }
    selectMod(key);
  }, [handleSaveAll, selectMod]);

  // ★ v2: save the current multi-selection as an offline collection
  const handleSaveSelectionAsCollection = useCallback(() => {
    const selected = useModStore.getState().selectedModKeys;
    const currentMods = useModStore.getState().mods;
    const selectedMods = currentMods.filter((m) => selected.includes(`${m.source}_${m.fileId}`));
    const modMeta: Record<string, import("./lib/types").ModMeta> = {};
    for (const m of selectedMods) {
      const key = `${m.source}_${m.fileId}`;
      const meta: import("./lib/types").ModMeta = {
        title: m.title,
        author: m.author,
        source: m.source,
        fileId: m.fileId,
      };
      if (m.version) meta.version = m.version;
      modMeta[key] = meta;
    }
    setCollectionCreateSeed({
      modKeys: selectedMods.map((m) => `${m.source}_${m.fileId}`),
      modMeta,
    });
    setCollectionOpen(true);
  }, []);

  // ★ v2: build a new scheme (profile) from a collection
  const handleCreateSchemeFromCollection = useCallback(
    (collectionId: string) => {
      const col = useCollectionStore.getState().collections.find((c) => c.id === collectionId);
      if (!col) return;
      const now = new Date().toISOString();
      const groupEntries = (col.groups ?? []).map((g, i) => ({
        id: `col-group-${collectionId.slice(0, 8)}-${i}`,
        name: g.name,
        collapsed: false,
        modKeys: g.modKeys,
      }));
      const data: ProfileData = {
        version: 2,
        name: col.name,
        createdAt: now,
        gamePath: useAppStore.getState().gamePath ?? "",
        modKeys: col.modKeys,
        enabledMods: col.enabledMods ?? [...col.modKeys],
        modOrder: {},
        modSettings: {},
        groups: groupEntries,
        displayOrder: [
          ...groupEntries.map((g) => g.id),
          ...col.modKeys.filter((k) => !groupEntries.some((g) => g.modKeys.includes(k))),
        ],
        modMeta: col.modMeta,
      };
      setCollectionOpen(false);
      handleProfileLoad(data);
      setLastMessage(`已从集合 "${col.name}" 创建方案，请确认后保存`);
      // Auto-save the new scheme
      const catStore = useCategoryStore.getState();
      const noteStore = useNoteStore.getState();
      const saveData: ProfileData = {
        ...data,
        modCategories: Object.fromEntries(
          Object.keys(data.modMeta)
            .filter((k) => (catStore.modCats[k] ?? []).length > 0)
            .map((k) => [k, catStore.modCats[k]]),
        ),
        modNotes: Object.fromEntries(
          Object.keys(data.modMeta)
            .filter((k) => noteStore.notes[k]?.trim())
            .map((k) => [k, noteStore.notes[k].trim()]),
        ),
      };
      // Auto-save the new scheme
      saveProfile(data.name, JSON.stringify(saveData, null, 2)).catch(() => {});
    },
    [handleProfileLoad, setLastMessage],
  );

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
            <button
              onClick={() => setCollectionOpen(true)}
              title="管理离线 Mod 集合"
              className="text-xs px-2.5 py-1 border border-slate-600 hover:border-slate-400
                         text-slate-400 rounded transition-colors cursor-pointer shrink-0"
            >
              集合
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
            {saving ? (
              <span className="text-xs px-2.5 py-1 border border-blue-500/50 bg-blue-500/10
                               text-blue-400 rounded shrink-0">
                保存中...
              </span>
            ) : (
              <button
                onClick={handleSaveAll}
                className={`text-xs px-2.5 py-1 border rounded transition-all cursor-pointer shrink-0 ${
                  isDirty
                    ? "border-amber-500 bg-amber-500/20 text-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.5)] hover:border-amber-400 hover:bg-amber-500/30"
                    : "border-slate-600 hover:border-slate-400 text-slate-400"
                }`}
              >
                同步
              </button>
            )}
            {isDirty && !saving && (
              <span className="text-xs text-amber-400 animate-pulse shrink-0">未保存</span>
            )}
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
                saving={saving}
                onSelectMod={handleSelectMod}
                onSaveSelectionAsCollection={handleSaveSelectionAsCollection}
              />
            </div>

            {/* ★ v2: collection panel — full-screen overlay (sub-page mode) */}
            {collectionOpen && (
              <CollectionPanel
                mods={mods}
                onClose={() => {
                  setCollectionOpen(false);
                  setCollectionCreateSeed(null);
                }}
                onCreateSchemeFromCollection={handleCreateSchemeFromCollection}
                seed={collectionCreateSeed}
              />
            )}

            {/* Settings editor — overlaid when a mod is selected */}
            {selectedMod && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <SettingsEditor
                  mod={selectedMod}
                  onClose={() => selectMod(null)}
                  onSettingsSaved={(settings) => {
                    updateModSettings(selectedModKey!, settings);
                    addDirtyModSetting(selectedModKey!);
                    setDirty(true);
                  }}
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
