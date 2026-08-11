/**
 * U+FF04 FULLWIDTH DOLLAR SIGN - presentation stand-in for escaped `\$`.
 * Both the editor widget and HTML render paths import this constant so the
 * two presentation layers cannot drift apart.
 */
export const ESCAPED_DOLLAR_GLYPH = "\uFF04";

/** Optional HTML class for the wrapper span around the glyph. */
export const ESCAPED_DOLLAR_HTML_CLASS = "md-escaped-dollar";

/**
 * Replace CommonMark dollar-escapes (`\$`) with ESCAPED_DOLLAR_GLYPH.
 * Leaves `\\$` (escaped backslash + bare dollar) alone.
 * Safe to run only on text where code spans/blocks are already masked.
 *
 *   "\$"   -> "＄"
 *   "\\$"  -> unchanged (Escape is "\\", then bare "$")
 *   "\\\$" -> "\\" + "＄"  (escaped "\" + escaped "$")
 */
export function replaceEscapedDollars(text: string): string {
  // Even run of backslashes (incl. 0), then \$, not part of a longer \\ pair.
  return text.replace(
    /(?<!\\)((?:\\\\)*)\\\$/g,
    (_m, bs: string) => bs + ESCAPED_DOLLAR_GLYPH,
  );
}

/**
 * Same rewrite as replaceEscapedDollars but wraps the glyph in a span so
 * HTML paths get a light styling hook (class = ESCAPED_DOLLAR_HTML_CLASS).
 * Backslash runs before the escape are preserved.
 */
export function replaceEscapedDollarsHtml(text: string): string {
  return text.replace(
    /(?<!\\)((?:\\\\)*)\\\$/g,
    (_m, bs: string) =>
      `${bs}<span class="${ESCAPED_DOLLAR_HTML_CLASS}">${ESCAPED_DOLLAR_GLYPH}</span>`,
  );
}
