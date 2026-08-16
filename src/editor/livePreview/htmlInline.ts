/**
 * Pure parsing / pairing helpers for the live-preview inline-HTML allowlist
 * (`<sup>`, `<sub>`, `<mark>`, void `<br>`). No EditorView, no DOM, no
 * decoration logic here - unit-testable in isolation.
 *
 * Safety: only *bare* allowlisted tags are recognized. Attributed tags and
 * every non-allowlisted tag parse as `other` and are left raw on disk.
 */

export type HtmlInlineName = "sup" | "sub" | "mark" | "br";

const PAIR_TAG_NAMES = ["sup", "sub", "mark"] as const;

/** Tag names the live preview may render as real typography. */
export const HTML_INLINE_ALLOWLIST: readonly HtmlInlineName[] = [...PAIR_TAG_NAMES, "br"];

export type ParsedHtmlInlineTag =
  | { kind: "open" | "close"; name: Exclude<HtmlInlineName, "br">; bare: true }
  | { kind: "void"; name: "br"; bare: true }
  | { kind: "other" };

// Bare open/close: <sup> </sup> <sub> </sub> <mark> </mark> (case-insensitive,
// optional inner whitespace, e.g. "< sup >" which lezer may emit).
const OPEN_CLOSE_RE = new RegExp(`^<\\s*(\\/)?\\s*(${PAIR_TAG_NAMES.join("|")})\\s*>$`, "i");
// Void br: <br> <br/> <br /> (case-insensitive).
const BR_RE = /^<\s*br\s*\/?\s*>$/i;

export function parseHtmlInlineTag(raw: string): ParsedHtmlInlineTag {
  if (BR_RE.test(raw)) return { kind: "void", name: "br", bare: true };
  const m = OPEN_CLOSE_RE.exec(raw);
  if (m) {
    return {
      kind: m[1] ? "close" : "open",
      name: m[2]!.toLowerCase() as Exclude<HtmlInlineName, "br">,
      bare: true,
    };
  }
  return { kind: "other" };
}

export type HtmlTagSpan = {
  from: number;
  to: number;
  raw: string;
  /** Document position of the direct syntax parent node (e.g. the Paragraph), or -1 if absent. */
  parentFrom: number;
};

export type HtmlInlinePair =
  | {
      type: "pair";
      name: "sup" | "sub" | "mark";
      open: HtmlTagSpan;
      close: HtmlTagSpan;
      contentFrom: number; // open.to
      contentTo: number; // close.from
    }
  | {
      type: "void";
      name: "br";
      tag: HtmlTagSpan;
    };

/**
 * Stack-match allowlisted bare tags in document order. Unmatched opens /
 * closes / mismatches are left out (fail closed): a close that does not match
 * the top of the stack is ignored without popping anything.
 */
export function pairHtmlInlineTags(tags: HtmlTagSpan[]): HtmlInlinePair[] {
  const stack: { name: "sup" | "sub" | "mark"; tag: HtmlTagSpan }[] = [];
  const pairs: HtmlInlinePair[] = [];

  for (const tag of tags) {
    const p = parseHtmlInlineTag(tag.raw);
    if (p.kind === "other") continue;
    if (p.kind === "void") {
      pairs.push({ type: "void", name: "br", tag });
      continue;
    }
    if (p.kind === "open") {
      stack.push({ name: p.name, tag });
      continue;
    }
    const top = stack[stack.length - 1];
    // Same direct syntax parent => no cross-block pairs. A close in block B
    // must not close an open from block A (fail closed).
    if (
      top &&
      top.name === p.name &&
      top.tag.parentFrom === tag.parentFrom &&
      top.tag.parentFrom >= 0
    ) {
      stack.pop();
      pairs.push({
        type: "pair",
        name: p.name,
        open: top.tag,
        close: tag,
        contentFrom: top.tag.to,
        contentTo: tag.from,
      });
    }
    // parent-mismatched / mismatched / orphan close: ignored, stack untouched
  }

  return pairs;
}
