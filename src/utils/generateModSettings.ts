import luaparse from "luaparse";
import type { ModInfo } from "../lib/types";

interface ModSettingsData {
  workshopIds: string[];
  localIds: string[];
  modOrder: Record<string, number>;
}

/**
 * Extract mod settings data from the current mod list.
 * Excludes residual mods (missing/empty Config.lua) to avoid game fallback.
 */
export function collectModSettingsData(mods: ModInfo[]): ModSettingsData {
  const valid = mods.filter((m) => !m.isResidual);
  return {
    workshopIds: valid
      .filter((m) => m.enabled && m.source === 1)
      .map((m) => `${m.source}_${m.fileId}`),
    localIds: valid
      .filter((m) => m.enabled && m.source === 0)
      .map((m) => `${m.source}_${m.fileId}`),
    modOrder: Object.fromEntries(
      valid
        .filter((m) => m.enabled)
        .map((m) => [`${m.source}_${m.fileId}`, m.order])
    ),
  };
}

/**
 * Patch the original ModSettings.Lua raw text with current enabled/order data.
 * Only modifies the list items inside each section — format is 100% preserved.
 */
export function patchModSettingsLua(raw: string, data: ModSettingsData): string {
  console.log("[patchModSettingsLua] templateRaw length:", raw.length);
  console.log("[patchModSettingsLua] templateRaw first 200 chars:", raw.slice(0, 200));
  console.log("[patchModSettingsLua] data:", JSON.stringify(data));

  let result = raw;

  // Replace EnabledWorkshopMods
  result = replaceListSection(result, "EnabledWorkshopMods", data.workshopIds, "keyed");
  // Replace EnabledLocalMods
  result = replaceListSection(result, "EnabledLocalMods", data.localIds, "keyed");
  // Replace ModOrder
  const orderPairs = Object.entries(data.modOrder).map(([k, v]) => [k, String(v)] as [string, string]);
  result = replaceListSection(result, "ModOrder", orderPairs, "pairs");

  // Validate the generated Lua syntax
  try {
    luaparse.parse(result);
    console.log("[patchModSettingsLua] output syntax: VALID, length:", result.length);
  } catch (e) {
    console.error("[patchModSettingsLua] output syntax: INVALID!", String(e));
    console.log("[patchModSettingsLua] output first 500 chars:", result.slice(0, 500));
  }

  return result;
}

type EntryMode = "keyed" | "pairs";

/**
 * Replace the content of a Lua table section like `Key = { ... entries ... },`.
 * keyed: entries are string values → [1] = "val",
 * pairs: entries are [key, value] pairs → ["key"] = val,
 *
 * Handles both \n and \r\n line endings.
 * If the section doesn't exist and entries are provided, appends it before the closing `}`.
 */
function replaceListSection(
  raw: string,
  sectionKey: string,
  entries: string[] | [string, string][],
  mode: EntryMode,
): string {
  // Detect line ending from the original content
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  const indent = "\t";

  // Find the section start
  const startPattern = new RegExp(
    `(\\b${escapeRegex(sectionKey)}\\s*=\\s*\\{\\s*\\r?\\n)`,
    "m",
  );
  const startMatch = startPattern.exec(raw);
  if (!startMatch) {
    // Section doesn't exist — if we have entries, append before closing `}`
    if ((Array.isArray(entries) && entries.length === 0) || entries.length === 0) {
      return raw;
    }
    return insertNewSection(raw, sectionKey, entries, mode, nl, indent);
  }

  // Find the matching closing brace: track nesting level
  let depth = 1;
  const startIdx = startMatch.index + startMatch[0].length;
  let pos = startIdx;
  while (pos < raw.length && depth > 0) {
    const ch = raw[pos];
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    pos++;
  }
  // pos now points past the closing `}`
  const suffix = raw.slice(pos); // everything after `}` (e.g. ",\r\n}\r\n")

  // Build new entries
  let content: string;
  if (mode === "pairs") {
    content = (entries as [string, string][])
      .map(([k, v]) => `${indent}${indent}["${k}"] = ${v},`)
      .join(nl);
  } else {
    content = (entries as string[])
      .map((id, i) => `${indent}${indent}[${i + 1}] = "${id}",`)
      .join(nl);
  }

  if (!content) {
    // Empty section — remove the entire section entry from the file
    // prefix ends right before the section start, suffix starts after the section's trailing ",\r\n"
    const beforeSection = raw.slice(0, startMatch.index);
    // Strip trailing whitespace before section so we don't leave blank lines
    const cleanBefore = beforeSection.replace(/[\t ]+$/, "");
    // suffix typically starts with ",\r\n" — consume it; keep rest
    const afterSection = suffix.replace(/^,[\r\n]+/, "").replace(/^[\r\n]+/, "");
    return cleanBefore + (afterSection ? nl + afterSection : "");
  }

  if (content) content += nl;
  const prefix = raw.slice(0, startMatch.index) + startMatch[1];
  // suffix already contains the section's trailing ",\r\n" + rest of file
  return prefix + content + "}" + suffix;
}

/**
 * Insert a new section before the closing `}` of the root table.
 */
function insertNewSection(
  raw: string,
  sectionKey: string,
  entries: string[] | [string, string][],
  mode: EntryMode,
  nl: string,
  indent: string,
): string {
  // Build the section content
  let section = `${nl}${indent}${sectionKey} = {${nl}`;
  if (mode === "pairs") {
    section += (entries as [string, string][])
      .map(([k, v]) => `${indent}${indent}["${k}"] = ${v},`)
      .join(nl);
  } else {
    section += (entries as string[])
      .map((id, i) => `${indent}${indent}[${i + 1}] = "${id}",`)
      .join(nl);
  }
  section += `${nl}${indent}},${nl}`;

  // Find the last `}` (closing of root return table)
  const lastBrace = raw.lastIndexOf("}");
  if (lastBrace === -1) {
    // No root table — build from scratch
    return `return {${section}}${nl}`;
  }
  return raw.slice(0, lastBrace) + section + raw.slice(lastBrace);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Generate complete ModSettings.Lua text.
 * Only includes sections that have content; omits empty sections to
 * avoid triggering the game's fallback-safety mechanism.
 */
export function generateModSettingsLua(data: ModSettingsData): string {
  const lines = ["return {", ""];
  const orderEntries = Object.entries(data.modOrder);

  if (data.workshopIds.length > 0 || data.localIds.length > 0 || orderEntries.length > 0) {
    if (data.workshopIds.length > 0) {
      lines.push("\tEnabledWorkshopMods = {");
      data.workshopIds.forEach((id, i) => {
        lines.push(`\t\t[${i + 1}] = "${id}",`);
      });
      lines.push("\t},");
      lines.push("");
    }

    if (data.localIds.length > 0) {
      lines.push("\tEnabledLocalMods = {");
      data.localIds.forEach((id, i) => {
        lines.push(`\t\t[${i + 1}] = "${id}",`);
      });
      lines.push("\t},");
      lines.push("");
    }

    if (orderEntries.length > 0) {
      lines.push("\tModOrder = {");
      for (const [id, ord] of orderEntries) {
        lines.push(`\t\t["${id}"] = ${ord},`);
      }
      lines.push("\t},");
      lines.push("");
    }
  }

  lines.push("}");
  lines.push("");
  const result = lines.join("\n");

  // Validate the generated Lua syntax
  try {
    luaparse.parse(result);
    console.log("[generateModSettingsLua] output syntax: VALID, length:", result.length);
  } catch (e) {
    console.error("[generateModSettingsLua] output syntax: INVALID!", String(e));
    console.log("[generateModSettingsLua] output:", result.slice(0, 500));
  }

  return result;
}
