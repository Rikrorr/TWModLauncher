/**
 * Parse and render text with <color=#RRGGBB>text</color> markup.
 * Returns React fragment with styled spans.
 */
import { Fragment } from "react";

interface Segment {
  text: string;
  color?: string;
}

function parseColorTags(raw: string): Segment[] {
  const segments: Segment[] = [];
  const re = /<color=([#\w]+)>(.*?)<\/color>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: raw.slice(lastIndex, match.index) });
    }
    segments.push({ text: match[2], color: match[1] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < raw.length) {
    segments.push({ text: raw.slice(lastIndex) });
  }
  return segments;
}

export function renderColoredText(text: string): React.ReactNode {
  if (!text) return text;
  const segments = parseColorTags(text);
  if (segments.length === 0) return text;
  if (segments.length === 1 && !segments[0].color) return text;

  return (
    <Fragment>
      {segments.map((seg, i) =>
        seg.color ? (
          <span key={i} style={{ color: seg.color }}>
            {seg.text}
          </span>
        ) : (
          <Fragment key={i}>{seg.text}</Fragment>
        ),
      )}
    </Fragment>
  );
}
