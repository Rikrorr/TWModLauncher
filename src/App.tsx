import { useCallback, useEffect, useState } from "react";
import { open, ask, message } from "@tauri-apps/plugin-dialog";
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
  saveProfile,
  listProfiles,
} from "./lib/tauriApi";
import { collectModSettingsData, patchModSettingsLua, generateModSettingsLua, generateSettingsLua } from "./utils/generateModSettings";
import { loadScheme, buildLoadOrderMap, sanitizeSchemeName } from "./utils/schemeMembers";
import { useAppStore } from "./store/useAppStore";
import { useModStore } from "./store/useModStore";
import { useCategoryStore } from "./store/useCategoryStore";
import { useNoteStore } from "./store/useNoteStore";
import { useModScanner } from "./hooks/useModScanner";
import { useCollectionStore } from "./store/useCollectionStore";
import type { PageKey, ProfileData } from "./lib/types";
import Sidebar from "./components/Sidebar";
import LaunchPage from "./pages/LaunchPage";
import SchemesPage from "./pages/SchemesPage";
import CollectionsPage from "./pages/CollectionsPage";
import ModsPage from "./pages/ModsPage";
import SettingsPage from "./pages/SettingsPage";
import LogsPage from "./pages/LogsPage";

function App() {
  const gamePath = useAppStore((s) => s.gamePath);
  const detecting = useAppStore((s) => s.detecting);
  const error = useAppStore((s) => s.error);
  const setGamePath = useAppStore((s) => s.setGamePath);
  const setDetecting = useAppStore((s) => s.setDetecting);
  const setError = useAppStore((s) => s.setError);
  const clearPath = useAppStore((s) => s.clearPath);
  const setLastMessage = useAppStore((s) => s.setLastMessage);
  const lastMessage = useAppStore((s) => s.lastMessage);
  const templateRaw = useAppStore((s) => s.templateRaw);
  const setDirty = useAppStore((s) => s.setDirty);

  const clearMods = useModStore((s) => s.clearMods);
  const selectMod = useModStore((s) => s.selectMod);
  const mods = useModStore((s) => s.mods);
  const { scan, rescan } = useModScanner();

  // ★ v2: hydrate global category/note/collection stores on startup
  useEffect(() => {
    useCategoryStore.getState().hydrate();
    useNoteStore.getState().hydrate();
    useCollectionStore.getState().hydrate();
  }, []);

  const [gameRunning, setGameRunning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // ★ v2.1: scheme-name dialog when creating a scheme from a collection
  const [schemeDraft, setSchemeDraft] = useState<{
    collectionId: string;
    collectionName: string;
    name: string;
    hint: string;
  } | null>(null);
  const [existingSchemeNames, setExistingSchemeNames] = useState<Set<string>>(new Set());
  // ★ v3: cross-page collection creation seed (from ModsPage multi-select)
  const [collectionSeed, setCollectionSeed] = useState<{
    modKeys: string[];
    modMeta: Record<string, import("./lib/types").ModMeta>;
    modSettings: Record<string, Record<string, unknown>>;
  } | null>(null);
  // ★ v3: current sub-page (sidebar navigation)
  const [currentPage, setCurrentPage] = useState<PageKey>(() =>
    useAppStore.getState().gamePath ? "launch" : "settings",
  );

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
    // ★ v2.1: with a scheme active, ModSettings.Lua must reflect the scheme view
    // (已读取Mod edits are the default config, not the active scheme state)
    const activeScheme = useAppStore.getState().activeSchemeName;
    let data: ReturnType<typeof collectModSettingsData>;
    if (activeScheme) {
      const scheme = await loadScheme(activeScheme);
      if (scheme) {
        const memberSet = new Set(scheme.modKeys ?? []);
        const enabledSet = new Set(scheme.enabledMods);
        // ★ v2.1: dense 1..N over ALL read mods from the scheme load order
        const allKeys = currentMods.map((m) => `${m.source}_${m.fileId}`);
        const loadPos = buildLoadOrderMap(allKeys, scheme);
        const synced = currentMods.map((m) => {
          const key = `${m.source}_${m.fileId}`;
          const inScheme = memberSet.has(key);
          return {
            ...m,
            enabled: inScheme && enabledSet.has(key),
            order: loadPos.get(key) ?? m.order,
          };
        });
        data = collectModSettingsData(synced);
      } else {
        data = collectModSettingsData(currentMods);
      }
    } else {
      data = collectModSettingsData(currentMods);
    }
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
            } catch {
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

    // ★ v2.1: activation no longer mutates any global display state
    // (mods / groups / categories / notes stay the pristine read-mods "default config",
    //  so the 已读取Mod page never changes with scheme activation).
    // The scheme's enabled/order view is built on the fly only when writing to disk.
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
      // ★ v2.1: dense 1..N over ALL read mods from the scheme load order —
      // mirrors the game own renumbering so the relative load order survives.
      const allKeys = currentMods.map((m) => `${m.source}_${m.fileId}`);
      const loadPos = buildLoadOrderMap(allKeys, data);
      const synced = currentMods.map((m) => {
        const key = `${m.source}_${m.fileId}`;
        const inScheme = memberSet.has(key);
        return {
          ...m,
          enabled: inScheme && enabledSet.has(key),
          order: loadPos.get(key) ?? m.order,
        };
      });
      const sd = collectModSettingsData(synced);
      const lua = templateRaw
        ? patchModSettingsLua(templateRaw, sd)
        : generateModSettingsLua(sd);
      await writeModSettings(activePath, lua);

      // ★ v3 (q3): apply the scheme's per-mod settings snapshots to disk
      const schemeSettings = data.modSettings ?? {};
      let perModFail = 0;
      for (const [key, values] of Object.entries(schemeSettings)) {
        if (!values || Object.keys(values).length === 0) continue;
        const mod = currentMods.find((m) => `${m.source}_${m.fileId}` === key);
        if (mod && mod.dirPath) {
          try {
            const raw = generateSettingsLua(values);
            await writeSettingsFile(mod.dirPath, raw);
          } catch {
            perModFail++;
          }
        }
      }

      useAppStore.getState().setDirty(false);
      setLastMessage(
        perModFail > 0
          ? `方案 "${data.name}" 已激活并同步（${perModFail} 个 Mod 配置写入失败）`
          : `方案 "${data.name}" 已激活并同步`,
      );
    } catch (e) {
      setLastMessage(`方案 "${data.name}" 激活失败（同步写入错误）: ${String(e)}`);
    }
  };

  const handleSelectMod = useCallback(async (key: string) => {
    // ★ v2.1: 已读取Mod页 edits the default config freely — no scheme gating
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
    const keys = selectedMods.map((m) => `${m.source}_${m.fileId}`);
    setCollectionSeed({
      modKeys: keys,
      modMeta,
      // ★ v3: carry the read-mods (base) config snapshot
      modSettings: Object.fromEntries(
        selectedMods
          .filter((m) => Object.keys(m.currentSettings).length > 0)
          .map((m) => [`${m.source}_${m.fileId}`, { ...m.currentSettings }]),
      ),
    });
    setCurrentPage("collections");
  }, []);

  // ★ v2: build a new scheme (profile) from a collection — ask for a name first
  const handleCreateSchemeFromCollection = useCallback((collectionId: string) => {
    const col = useCollectionStore.getState().collections.find((c) => c.id === collectionId);
    if (!col) return;
    // Prefetch existing scheme names for the duplicate-name hint
    listProfiles()
      .then((list) => setExistingSchemeNames(new Set(list.map((p) => p.name))))
      .catch(() => {});
    setSchemeDraft({ collectionId, collectionName: col.name, name: col.name, hint: "" });
  }, []);

  const handleSchemeDraftConfirm = useCallback(async () => {
    if (!schemeDraft) return;
    const rawName = schemeDraft.name.trim();
    if (!rawName) return;
    // Windows filename safety: strip characters invalid in file names,
    // and let the user decide before rewriting their input.
    const name = sanitizeSchemeName(rawName);
    if (name !== rawName) {
      const ok = await ask(
        `名称 "${rawName}" 包含文件名非法字符（如 / \\ : * ? " < > |），将以 "${name}" 创建。是否继续？`,
        { title: "名称含非法字符", kind: "warning" },
      );
      if (!ok) return;
    }
    const col = useCollectionStore.getState().collections.find(
      (c) => c.id === schemeDraft.collectionId,
    );
    if (!col) {
      setSchemeDraft(null);
      return;
    }
    setSchemeDraft(null);
    try {
      const now = new Date().toISOString();
      const groupEntries = (col.groups ?? []).map((g, i) => ({
        id: `col-group-${col.id.slice(0, 8)}-${i}`,
        name: g.name,
        collapsed: false,
        modKeys: g.modKeys,
      }));
      const data: ProfileData = {
        version: 2,
        name,
        createdAt: now,
        gamePath: useAppStore.getState().gamePath ?? "",
        modKeys: col.modKeys,
        enabledMods: col.enabledMods ?? [...col.modKeys],
        modOrder: {},
        modSettings: col.modSettings ?? {},
        groups: groupEntries,
        displayOrder: [
          ...groupEntries.map((g) => g.id),
          ...col.modKeys.filter((k) => !groupEntries.some((g) => g.modKeys.includes(k))),
        ],
        modMeta: col.modMeta ?? {},
      };
      const catStore = useCategoryStore.getState();
      const noteStore = useNoteStore.getState();
      const saveData: ProfileData = {
        ...data,
        modCategories: Object.fromEntries(
          Object.keys(data.modMeta ?? {})
            .filter((k) => (catStore.modCats[k] ?? []).length > 0)
            .map((k) => [k, catStore.modCats[k]]),
        ),
        modNotes: Object.fromEntries(
          Object.keys(data.modMeta ?? {})
            .filter((k) => noteStore.notes[k]?.trim())
            .map((k) => [k, noteStore.notes[k].trim()]),
        ),
      };
      // ★ v2.1: persist FIRST (awaited, errors visible), then activate + navigate
      await saveProfile(name, JSON.stringify(saveData, null, 2));
      // Select the newly created scheme on the Schemes page (edit selection)
      useAppStore.getState().setSchemeEditName(name);
      handleProfileLoad(data);
      setCurrentPage("schemes");
      setLastMessage(
        name !== rawName
          ? `已从集合 "${col.name}" 创建方案 "${name}"（已移除文件名非法字符）`
          : `已从集合 "${col.name}" 创建方案 "${name}"`,
      );
    } catch (e) {
      const msg = `方案 "${rawName}" 保存失败: ${String(e)}`;
      setLastMessage(msg);
      void message(msg, { title: "创建方案失败", kind: "error" });
    }
  }, [handleProfileLoad, setLastMessage, schemeDraft]);
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100">
      {/* Body: Sidebar + active page */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <Sidebar
          current={currentPage}
          onNavigate={setCurrentPage}
          disabledKeys={gamePath ? undefined : ["schemes", "collections", "mods"]}
        />

        <main className="flex-1 overflow-hidden flex flex-col min-w-0">
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

              {/* Active sub-page */}
              {currentPage === "launch" && (
                <LaunchPage
                  mods={mods}
                  gamePath={gamePath}
                  gameRunning={gameRunning}
                  launchError={launchError}
                  onActivateScheme={handleProfileLoad}
                  onLaunchLocal={handleLaunch}
                  onLaunchSteam={handleLaunchSteam}
                  onKill={handleKill}
                  onGoSettings={() => setCurrentPage("settings")}
                />
              )}

              {currentPage === "schemes" && (
                <SchemesPage
                  mods={mods}
                  onActivate={handleProfileLoad}
                />
              )}

              {currentPage === "collections" && (
                <CollectionsPage
                  mods={mods}
                  onCreateSchemeFromCollection={handleCreateSchemeFromCollection}
                  seed={collectionSeed}
                  onSeedConsumed={() => setCollectionSeed(null)}
                />
              )}

              {currentPage === "mods" && (
                <ModsPage
                  mods={mods}
                  saving={saving}
                  refreshing={refreshing}
                  onRefresh={() => void handleRefresh()}
                  onSelectMod={handleSelectMod}
                  onSaveSelectionAsCollection={handleSaveSelectionAsCollection}
                  onSettingsSaved={() => {}}
                />
              )}

              {currentPage === "settings" && (
                <SettingsPage
                  gamePath={gamePath}
                  onPathSelected={(path) => {
                    setGamePath(path, "manual");
                  }}
                  onReselect={handleReselect}
                />
              )}

              {currentPage === "logs" && <LogsPage />}
            </>
          )}
        </main>
      </div>

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
        {lastMessage && (
          <span className="ml-auto truncate text-slate-300" title={lastMessage}>
            {lastMessage}
          </span>
        )}
      </footer>

      {/* Scheme-name dialog: creating a scheme from a collection */}
      {schemeDraft && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSchemeDraft(null);
          }}
        >
          <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl w-96 max-w-[90vw] p-5">
            <p className="text-sm font-semibold text-slate-200 mb-1">从集合创建方案</p>
            <p className="text-xs text-slate-500 mb-3">
              为基于集合「{schemeDraft.collectionName}」的新方案命名
            </p>
            <input
              value={schemeDraft.name}
              onChange={(e) => {
                const name = e.target.value;
                setSchemeDraft({
                  ...schemeDraft,
                  name,
                  hint: existingSchemeNames.has(name.trim())
                    ? "已存在同名方案，保存将覆盖该方案"
                    : "",
                });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSchemeDraftConfirm();
                if (e.key === "Escape") setSchemeDraft(null);
              }}
              autoFocus
              placeholder="方案名称..."
              className="w-full text-xs px-2.5 py-1.5 bg-slate-900 border border-slate-600 rounded
                         text-slate-200 outline-none focus:border-blue-500 mb-2"
            />
            {schemeDraft.hint && (
              <p className="text-xs text-amber-400 mb-2">{schemeDraft.hint}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setSchemeDraft(null)}
                className="text-xs px-3 py-1.5 border border-slate-600 text-slate-300 rounded cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSchemeDraftConfirm}
                disabled={!schemeDraft.name.trim()}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded cursor-pointer"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
