import type { EditorView } from "@codemirror/view";

/**
 * Hanging-indent width for a list marker prefix.
 *
 * Prefer a real text measure (editor font); fall back to CM average char width.
 * #1050 - proportional fonts make charCount * defaultCharacterWidth drift for
 * digits, ".", "-", and spaces. #462 history: coordsAtPos is banned inside
 * buildDecorations (CM6 layout read during update), so we measure with canvas
 * measureText instead and keep the charWidth fallback for jsdom / headless /
 * font-not-ready cases.
 */
export function listPrefixIndentPx(
  prefix: string,
  fallbackCharWidth: number,
  measureWidth?: (text: string) => number | null | undefined,
): number {
  const measured = measureWidth?.(prefix);
  if (typeof measured === "number" && Number.isFinite(measured) && measured > 0) {
    return Math.round(measured);
  }
  return Math.round(prefix.length * fallbackCharWidth);
}

/**
 * Editor-font text measure for list hanging indent (#1050).
 *
 * Font + canvas cached per view, re-read when the computed font changes.
 * Uses canvas measureText (never CM layout APIs like coordsAtPos, which are
 * banned during an update per #462). Returns null when metrics are
 * unavailable (jsdom / headless / font not ready) so callers fall back to
 * defaultCharacterWidth.
 */
const editorMeasureCache = new WeakMap<
  EditorView,
  { font: string; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null }
>();

export function measureEditorTextWidth(
  view: EditorView,
  text: string,
): number | null {
  if (typeof document === "undefined" || !view.contentDOM) return null;
  // jsdom ships a stub HTMLCanvasElement whose getContext throws a noisy
  // "Not implemented" error; bail to the charWidth fallback instead of
  // probing canvas there. Production browsers always pass this guard.
  if (
    typeof navigator !== "undefined" &&
    typeof navigator.userAgent === "string" &&
    navigator.userAgent.includes("jsdom")
  ) {
    return null;
  }
  let font: string;
  try {
    font = getComputedStyle(view.contentDOM).font;
  } catch {
    return null;
  }
  let entry = editorMeasureCache.get(view);
  if (!entry || entry.font !== font) {
    const canvas = document.createElement("canvas");
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    entry = { font, canvas, ctx };
    editorMeasureCache.set(view, entry);
    if (ctx) ctx.font = font;
  }
  if (!entry.ctx) return null;
  const width = entry.ctx.measureText(text).width;
  return Number.isFinite(width) && width > 0 ? width : null;
}

/**
 * CommonMark default tab stop for list column math (#1057).
 *
 * CommonMark resolves tabs to tab stops of 4 columns for list indentation, so
 * column math for list continuation hides must use 4 regardless of the CM
 * editor's configured tab size.
 */
export const LIST_TAB_SIZE = 4;

/**
 * Column offset from the start of `text` to `charOffset`, expanding tabs to
 * `tabSize` columns (CommonMark). Non-tab chars advance one column.
 *
 * `charOffset` is clamped to `[0, text.length]`. #1057 - column math for list
 * continuation hides is tab-aware.
 */
export function columnAt(
  text: string,
  charOffset: number,
  tabSize: number = LIST_TAB_SIZE,
): number {
  const clamped = Math.max(0, Math.min(charOffset, text.length));
  let col = 0;
  for (let i = 0; i < clamped; i++) {
    col = text[i] === "\t" ? (Math.floor(col / tabSize) + 1) * tabSize : col + 1;
  }
  return col;
}

/**
 * Blockquote marker prefix on a list continuation line, aligned with
 * `addBlockquoteDecos`' `/^(\s*>)\s?/`. `>` is not treated as content end.
 */
const BLOCKQUOTE_MARKER_RE = /^(\s*>)\s?/;

/**
 * On a list continuation line, return the exclusive char offset into `lineText`
 * at which structural indent ends (the range `[0, end)` within the line text is
 * hidden via `Decorations.replace`).
 *
 * - Skips a leading blockquote marker (same shape `addBlockquoteDecos` hides)
 *   without treating `>` as content end.
 * - Then consumes spaces/tabs while the running column is < `contentColumn`.
 * - Stops at first non-whitespace content, or when column reaches
 *   `contentColumn`.
 * - Returns 0 when there is nothing to hide (no blockquote prefix and no
 *   leading spaces/tabs consumed). A blockquote-prefixed line with no extra
 *   spaces returns the prefix length so callers can compute the non-overlapping
 *   hide range. #1057
 */
export function listContinuationIndentEnd(
  lineText: string,
  contentColumn: number,
  tabSize: number = LIST_TAB_SIZE,
): number {
  const bq = lineText.match(BLOCKQUOTE_MARKER_RE);
  const startChar = bq ? bq[0].length : 0;
  let col = columnAt(lineText, startChar, tabSize);
  let i = startChar;
  while (i < lineText.length) {
    const ch = lineText[i];
    if (ch !== " " && ch !== "\t") break;
    if (col >= contentColumn) break;
    col = ch === "\t" ? (Math.floor(col / tabSize) + 1) * tabSize : col + 1;
    i++;
  }
  return i === 0 ? 0 : i;
}
