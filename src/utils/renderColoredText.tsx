/**
 * Render Unity-style rich text markup into styled React elements.
 * Supports <color=#RRGGBB|name>, <b>, <i>, <size=N> — nested and multi-line.
 * Unknown or mismatched tags are shown literally; unclosed known tags apply
 * their style to the rest of the text (Unity semantics).
 */
import { Fragment, type CSSProperties, type ReactNode } from "react";
import {
  parseRichText,
  type RichStyle,
  type RichTextNode,
} from "./richTextParser";

function styleToCss(style: RichStyle): CSSProperties {
  const css: CSSProperties = {};
  if (style.color) css.color = style.color;
  if (style.bold) css.fontWeight = "bold";
  if (style.italic) css.fontStyle = "italic";
  if (style.fontSize) css.fontSize = style.fontSize;
  return css;
}

function renderNode(node: RichTextNode, key: number): ReactNode {
  const children = node.children.map((child, i) =>
    typeof child === "string" ? child : renderNode(child, i),
  );
  const css = styleToCss(node.style);
  if (Object.keys(css).length > 0) {
    return (
      <span key={key} style={css}>
        {children}
      </span>
    );
  }
  return <Fragment key={key}>{children}</Fragment>;
}

export function renderColoredText(text: string): ReactNode {
  if (!text) return text;
  const root = parseRichText(text);
  // No markup → return the original string unchanged.
  if (root.children.length === 1 && typeof root.children[0] === "string") {
    return text;
  }
  return (
    <Fragment>
      {root.children.map((child, i) =>
        typeof child === "string" ? child : renderNode(child, i),
      )}
    </Fragment>
  );
}
