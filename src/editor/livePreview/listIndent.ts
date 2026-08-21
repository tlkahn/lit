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
