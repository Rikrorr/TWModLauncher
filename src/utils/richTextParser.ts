/**
 * Pure parser for Unity-style rich text markup.
 *
 * Supported tags:
 *   <color=#RRGGBB|name>text</color>  — text color
 *   <b>text</b>                       — bold
 *   <i>text</i>                       — italic
 *   <size=N>text</size>               — font size in px
 *
 * Semantics:
 *   - Tags nest and span multiple lines.
 *   - Unknown tags / malformed tags / mismatched closing tags are kept as
 *     literal text (content is never dropped).
 *   - An unclosed known tag applies its style to the rest of the text
 *     (Unity behaviour).
 *
 * This module is framework-free so it can be unit-tested in plain Node.
 */

export interface RichStyle {
  color?: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: string;
}

export interface RichTextNode {
  /** Tag that opened this node (undefined for the root node) */
  tag?: string;
  /** Style merged from all open ancestors + this node */
  style: RichStyle;
  children: RichTextChild[];
}

export type RichTextChild = RichTextNode | string;

interface TextToken {
  kind: "text";
  text: string;
}
interface OpenToken {
  kind: "open";
  tag: string;
  value?: string;
  raw: string;
}
interface CloseToken {
  kind: "close";
  tag: string;
  raw: string;
}
type Token = TextToken | OpenToken | CloseToken;

const KNOWN_TAGS = new Set(["color", "b", "i", "size"]);

/** Match tag-like segments: <...> (anything without '>') */
const TAG_LIKE = /<[^>]*>/g;
/** Valid opening tag: <name> or <name=value> */
const OPEN_TAG_RE = /^<\s*([a-zA-Z][a-zA-Z0-9]*)\s*(?:=\s*([^>]*?))?\s*>$/;
/** Valid closing tag: </name> */
const CLOSE_TAG_RE = /^<\s*\/\s*([a-zA-Z][a-zA-Z0-9]*)\s*>$/;

function isValidColor(value: string): boolean {
  // #RGB / #RRGGBB / #RRGGBBAA hex, or a simple named color (e.g. red, white)
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return true;
  return /^[a-zA-Z]+$/.test(value);
}

function isValidSize(value: string): boolean {
  return /^\d+(?:px)?$/.test(value);
}

/** Merge a tag's effect onto an existing style. Invalid values are ignored. */
function applyStyle(base: RichStyle, tag: string, value?: string): RichStyle {
  switch (tag) {
    case "color":
      return value && isValidColor(value) ? { ...base, color: value } : base;
    case "b":
      return { ...base, bold: true };
    case "i":
      return { ...base, italic: true };
    case "size":
      return value && isValidSize(value)
        ? { ...base, fontSize: `${parseInt(value, 10)}px` }
        : base;
    default:
      return base;
  }
}

/** Check whether a known tag with its value is well-formed. */
function isValidTag(tag: string, value?: string): boolean {
  if (tag === "b" || tag === "i") return value === undefined || value === "";
  if (tag === "color") return !!value && isValidColor(value);
  if (tag === "size") return !!value && isValidSize(value);
  return false;
}

function tokenize(raw: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of raw.matchAll(TAG_LIKE)) {
    const idx = match.index;
    if (idx > last) {
      tokens.push({ kind: "text", text: raw.slice(last, idx) });
    }
    const seg = match[0];
    const close = CLOSE_TAG_RE.exec(seg);
    if (close) {
      tokens.push({ kind: "close", tag: close[1], raw: seg });
    } else {
      const open = OPEN_TAG_RE.exec(seg);
      if (open && KNOWN_TAGS.has(open[1]) && isValidTag(open[1], open[2])) {
        tokens.push({ kind: "open", tag: open[1], value: open[2], raw: seg });
      } else {
        // Unknown tag, malformed syntax, or invalid value → literal text
        tokens.push({ kind: "text", text: seg });
      }
    }
    last = idx + seg.length;
  }
  if (last < raw.length) {
    tokens.push({ kind: "text", text: raw.slice(last) });
  }
  return tokens;
}

/**
 * Parse rich text into a node tree. The root node carries no style.
 */
export function parseRichText(raw: string): RichTextNode {
  const root: RichTextNode = { style: {}, children: [] };
  const stack: RichTextNode[] = [root];

  for (const token of tokenize(raw)) {
    const current = stack[stack.length - 1];

    if (token.kind === "text") {
      if (token.text) current.children.push(token.text);
      continue;
    }

    if (token.kind === "open") {
      const node: RichTextNode = {
        tag: token.tag,
        style: applyStyle(current.style, token.tag, token.value),
        children: [],
      };
      current.children.push(node);
      stack.push(node);
      continue;
    }

    // Closing tag: pop back to the nearest matching open tag.
    // The tree is already built, so popping only affects where the
    // remaining tokens attach (styles of closed nodes are preserved).
    let found = -1;
    for (let i = stack.length - 1; i >= 1; i--) {
      if (stack[i].tag === token.tag) {
        found = i;
        break;
      }
    }
    if (found !== -1) {
      stack.length = found;
    } else {
      // Mismatched closing tag → literal text
      current.children.push(token.raw);
    }
  }

  return root;
}
