import luaparse from "luaparse";

// ── AST helpers (luaparse has no official types) ──

interface LuaNode {
  type: string;
  value?: unknown;
  raw?: unknown;
  name?: unknown;
  key?: unknown;
  fields?: unknown;
  arguments?: unknown;
  operator?: unknown;
  argument?: unknown;
  init?: unknown;
  variables?: unknown;
  body?: unknown;
}

/** Convert any AST key node to its string representation. */
function keyToString(node: LuaNode | null | undefined): string {
  if (!node) return "";
  switch (node.type) {
    case "StringLiteral": {
      const sl = node as { value: string | null; raw: string };
      // luaparse may put the decoded string in .value or only in .raw (with quotes)
      if (typeof sl.value === "string") return sl.value;
      return sl.raw.replace(/^["']|["']$/g, "");
    }
    case "NumericLiteral":
      return String((node as { value: number }).value);
    case "Identifier":
      return (node as { name: string }).name;
    default:
      return "";
  }
}

/** Extract the decoded string from a luaparse StringLiteral node. */
function extractString(node: LuaNode): string {
  const sl = node as { value: string | null; raw: string };
  if (typeof sl.value === "string") return sl.value;
  // Fallback: strip surrounding quotes from raw
  return sl.raw.replace(/^["']|["']$/g, "");
}

function extractValue(node: LuaNode): unknown {
  switch (node.type) {
    case "StringLiteral":
      return extractString(node);
    case "NumericLiteral":
      return (node as { value: number }).value;
    case "BooleanLiteral":
      return (node as { value: boolean }).value;
    case "NilLiteral":
      return null;
    case "TableConstructorExpression": {
      const fields: LuaNode[] =
        ((node as { fields: LuaNode[] }).fields) ?? [];
      if (fields.length === 0) return {};

      // Determine if this is a pure array (only numeric-keyed or unkeyed entries)
      let isPureArray = true;
      for (const f of fields) {
        if (f.type === "TableKey") {
          const keyNode = f.key as LuaNode | undefined;
          if (!keyNode || keyNode.type !== "NumericLiteral") {
            isPureArray = false;
            break;
          }
        } else if (f.type !== "TableValue") {
          // TableKeyString → named key, so it's an object
          isPureArray = false;
          break;
        }
      }

      if (isPureArray) {
        const arr: unknown[] = [];
        for (const f of fields) {
          if (f.type === "TableValue" || f.type === "TableKey") {
            arr.push(extractValue(f.value as LuaNode));
          }
        }
        return arr;
      }

      // Object-like table — handle all field types
      const obj: Record<string, unknown> = {};
      for (const f of fields) {
        if (f.type === "TableKeyString") {
          const k = keyToString(f.key as LuaNode);
          if (k) {
            obj[k] = extractValue(f.value as LuaNode);
          }
        } else if (f.type === "TableKey") {
          const k = keyToString(f.key as LuaNode);
          if (k) {
            obj[k] = extractValue(f.value as LuaNode);
          }
        } else if (f.type === "TableValue") {
          // Array-style entry in a mixed table — use numeric index
          obj[String(Object.keys(obj).length + 1)] = extractValue(
            f.value as LuaNode
          );
        }
      }
      return obj;
    }
    case "UnaryExpression": {
      const op = node.operator as string;
      const argNode = node.argument as LuaNode;
      const arg = extractValue(argNode);
      if (op === "-" && typeof arg === "number") return -arg;
      return arg;
    }
    default:
      return null;
  }
}

function tableFromReturn(ast: { body: LuaNode[] }): Record<string, unknown> {
  const ret = ast.body.find((n) => n.type === "ReturnStatement");
  if (!ret) return {};
  const args = ret.arguments as LuaNode[] | undefined;
  if (!args || args.length === 0) return {};
  const table = args[0];
  if (table.type !== "TableConstructorExpression") return {};
  const extracted = extractValue(table);
  return (extracted as Record<string, unknown>) ?? {};
}

// ── Public API ──

export interface ParsedConfig {
  title: string;
  author: string;
  version: string;
  description: string;
  gameVersion: string;
  tags: string[];
  needRestart: boolean;
  defaultSettings: ModSettingDef[];
  parseError: boolean;
}

export interface ModSettingDef {
  settingType: "Toggle" | "Slider" | "Dropdown";
  key: string;
  displayName: string;
  description: string;
  groupName: string;
  defaultValue: unknown;
  minValue?: number;
  maxValue?: number;
  stepSize?: number;
  options?: Record<number, string>;
}

export interface ParsedModSettings {
  enabledWorkshopMods: string[];
  enabledLocalMods: string[];
  modOrder: Record<string, number>;
}

/**
 * Parse Config.lua raw text.
 * Returns defaults for every missing field — caller never gets undefined.
 */
export function parseConfigLua(raw: string): ParsedConfig {
  const defaults: ParsedConfig = {
    title: "",
    author: "未知",
    version: "",
    description: "",
    gameVersion: "",
    tags: [],
    needRestart: false,
    defaultSettings: [],
    parseError: false,
  };

  if (!raw.trim()) return defaults;

  let table: Record<string, unknown>;
  try {
    table = tableFromReturn(luaparse.parse(raw) as { body: LuaNode[] });
  } catch {
    return { ...defaults, parseError: true };
  }

  return {
    title: String(table.Title ?? table.title ?? defaults.title),
    author: String(table.Author ?? table.author ?? defaults.author),
    version: String(table.Version ?? table.version ?? defaults.version),
    description: String(
      table.Description ?? table.description ?? defaults.description,
    ),
    gameVersion: String(
      table.GameVersion ?? table.gameVersion ?? defaults.gameVersion,
    ),
    tags: parseTags(table.Tags ?? table.tags ?? table.TagList ?? table.tagList),
    needRestart: Boolean(
      table.NeedRestart ?? table.needRestart ?? defaults.needRestart,
    ),
    defaultSettings: parseDefaultSettings(
      table.DefaultSettings ?? table.defaultSettings,
    ),
    parseError: false,
  };
}

/** Parse Settings.Lua raw text → key-value map. */
export function parseSettingsLua(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    return tableFromReturn(luaparse.parse(raw) as { body: LuaNode[] });
  } catch {
    return {};
  }
}

/**
 * Parse ModSettings.Lua raw text → enabled list + order map.
 * Handles both `return { ... }` and top-level assignment formats.
 */
export function parseModSettingsLua(raw: string): ParsedModSettings {
  const result: ParsedModSettings = {
    enabledWorkshopMods: [],
    enabledLocalMods: [],
    modOrder: {},
  };
  if (!raw.trim()) return result;

  let ast: { body: LuaNode[] };
  try {
    ast = luaparse.parse(raw) as { body: LuaNode[] };
  } catch {
    return result;
  }

  // Check if the file uses `return { EnabledWorkshopMods = ..., ModOrder = ... }`
  const returned = tableFromReturn(ast);
  if (returned.EnabledWorkshopMods) {
    const enabled =
      (returned.EnabledWorkshopMods as string[]) ??
      Object.values(returned.EnabledWorkshopMods as Record<string, unknown>);
    result.enabledWorkshopMods = enabled.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
  }
  if (returned.EnabledLocalMods) {
    const local =
      (returned.EnabledLocalMods as string[]) ??
      Object.values(returned.EnabledLocalMods as Record<string, unknown>);
    result.enabledLocalMods = local.filter(
      (v): v is string => typeof v === "string" && v.length > 0,
    );
  }
  if (returned.ModOrder && typeof returned.ModOrder === "object") {
    const order = returned.ModOrder as Record<string, number>;
    for (const [k, v] of Object.entries(order)) {
      if (typeof v === "number") result.modOrder[k] = v;
    }
  }

  // Also support top-level assignment format:
  //   EnabledWorkshopMods = { ... }
  //   ModOrder = { ... }
  for (const stmt of ast.body) {
    if (stmt.type !== "AssignmentStatement") continue;
    const variables = stmt.variables as Array<{ type: string; name?: string }> | undefined;
    const init = stmt.init as LuaNode[] | undefined;
    const varName = variables?.[0]?.name;
    if (!varName) continue;
    const val = init?.[0];
    if (!val) continue;

    if (
      varName === "EnabledWorkshopMods" &&
      result.enabledWorkshopMods.length === 0
    ) {
      const arr = extractValue(val);
      if (Array.isArray(arr)) {
        result.enabledWorkshopMods = arr.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
      }
    } else if (
      varName === "EnabledLocalMods" &&
      result.enabledLocalMods.length === 0
    ) {
      const arr = extractValue(val);
      if (Array.isArray(arr)) {
        result.enabledLocalMods = arr.filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
      }
    } else if (
      varName === "ModOrder" &&
      Object.keys(result.modOrder).length === 0
    ) {
      const order = extractValue(val);
      if (order && typeof order === "object" && !Array.isArray(order)) {
        for (const [k, v] of Object.entries(order as Record<string, unknown>)) {
          if (typeof v === "number") result.modOrder[k] = v;
        }
      }
    }
  }

  return result;
}

// ── Internal helpers ──

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "object" && raw !== null) {
    return Object.values(raw).map(String);
  }
  return [];
}

function parseDefaultSettings(raw: unknown): ModSettingDef[] {
  const arr = Array.isArray(raw)
    ? raw
    : typeof raw === "object" && raw !== null
      ? Object.values(raw)
      : [];
  return arr.map(parseOneSetting).filter((s): s is ModSettingDef => s !== null && !!s.key);
}

function parseOneSetting(raw: unknown): ModSettingDef | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const settingType = String(r.SettingType ?? r.settingType ?? "");
  if (!["Toggle", "Slider", "Dropdown"].includes(settingType)) {
    return null;
  }
  return {
    settingType: settingType as ModSettingDef["settingType"],
    key: String(r.Key ?? r.key ?? ""),
    displayName: String(r.DisplayName ?? r.displayName ?? ""),
    description: String(r.Description ?? r.description ?? ""),
    groupName: String(r.GroupName ?? r.groupName ?? ""),
    defaultValue: r.DefaultValue ?? r.defaultValue ?? null,
    minValue: asOptionalNumber(r.MinValue ?? r.minValue),
    maxValue: asOptionalNumber(r.MaxValue ?? r.maxValue),
    stepSize: asOptionalNumber(r.StepSize ?? r.stepSize),
    options: parseOptions(r.Options ?? r.options),
  };
}

function parseOptions(raw: unknown): Record<number, string> | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const opts: Record<number, string> = {};
  for (const [k, v] of Object.entries(r)) {
    const n = Number(k);
    if (!Number.isNaN(n)) opts[n] = String(v);
  }
  return Object.keys(opts).length > 0 ? opts : undefined;
}

function asOptionalNumber(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isNaN(n) ? undefined : n;
  }
  return undefined;
}
