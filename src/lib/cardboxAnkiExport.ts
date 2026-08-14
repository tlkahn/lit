import type { CardboxAnnotation, CardboxAnkiNote } from "./ipc";
import { renderMarkdown, renderInlineMarkdown } from "./renderMarkdown";
import { KATEX_INLINE_CSS } from "./katexInlineCss";

/** Math sentinel shared with the HTML cardbox export (see renderMath.ts). */
const MATH_CLASS = "cm-preview-math";

/**
 * Build Anki note payloads from sorted cards. Input order is preserved - the
 * caller owns sorting via `sortByDocPosition`.
 */
export function buildCardboxAnkiNotes(
  cards: CardboxAnnotation[],
): { notes: CardboxAnkiNote[]; hasMath: boolean } {
  const notes: CardboxAnkiNote[] = [];
  let hasMath = false;
  for (const card of cards) {
    const frontHtml = renderMarkdown(card.body ?? "");
    // Skip cards whose rendered Front is empty - Anki's Basic model would
    // drop them anyway, and counting them would over-report the export.
    if (!frontHtml) continue;
    const original = card.original?.trim();
    const backHtml = original ? renderInlineMarkdown(original) : "";
    if (frontHtml.includes(MATH_CLASS) || backHtml.includes(MATH_CLASS)) {
      hasMath = true;
    }
    notes.push({ uuid: card.uuid, front_html: frontHtml, back_html: backHtml });
  }
  return { notes, hasMath };
}

/** Last path segment without its extension; mirrors the HTML flow's helper. */
function filenameStem(pagePath: string): string {
  const base = pagePath.split("/").pop() ?? pagePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Extra model CSS to send with the package: KaTeX styles when any note has
 * math, else undefined. Rust owns the base card typography block, so the
 * common path never ships the large KaTeX CSS.
 */
export function ankiModelCss(hasMath: boolean): string | undefined {
  return hasMath ? KATEX_INLINE_CSS : undefined;
}

/**
 * Deck name: first sorted card's `source_page_title`, else the filename
 * stem (same rule as the HTML cardbox export). Anki splits deck names on
 * `::` into a subdeck hierarchy, so the separator is replaced with ` - `
 * (display-only; page titles in the workspace are untouched).
 */
export function resolveAnkiDeckName(
  cards: CardboxAnnotation[],
  pagePath: string,
): string {
  const title = cards[0]?.source_page_title?.trim();
  return (title || filenameStem(pagePath)).replaceAll("::", " - ");
}
