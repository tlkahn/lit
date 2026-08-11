/**
 * U+FF04 FULLWIDTH DOLLAR SIGN - presentation stand-in for escaped `\$`.
 * Both the editor widget and HTML render paths import this constant so the
 * two presentation layers cannot drift apart.
 */
export const ESCAPED_DOLLAR_GLYPH = "\uFF04";

/** Optional HTML class for the wrapper span around the glyph. */
export const ESCAPED_DOLLAR_HTML_CLASS = "md-escaped-dollar";

/**
 * Neutral placeholder substituted for `\$` before `marked` parses. Never a
 * dollar, never HTML, so it is inert in URLs, titles, alt text, raw HTML
 * attributes and text alike (a `<span>` injected pre-parse is not: it corrupts
 * those non-text contexts). Restored context-aware after sanitization by
 * `restoreEscapedDollarsInHtml`. Uses the same U+FFF0 sentinel pair as the
 * existing code/math placeholders.
 */
export const ESCAPED_DOLLAR_PLACEHOLDER = "\uFFF0ESCDOL\uFFF0";

// `marked` percent-encodes non-ASCII characters in link/image destinations,
// so the placeholder appears in `href`/`src` attributes in this form.
const ESCAPED_DOLLAR_PLACEHOLDER_ENCODED = encodeURIComponent(ESCAPED_DOLLAR_PLACEHOLDER);

// Even run of backslashes (incl. 0), then \$, not part of a longer \\ pair.
const ESCAPED_DOLLAR_RE = /(?<!\\)((?:\\\\)*)\\\$/g;

/**
 * Shared owner of the even-backslash dollar-escape regex. Maps each matched
 * `\$` (preserving any preceding backslash run) through `map`.
 */
function mapEscapedDollars(text: string, map: (bs: string) => string): string {
  return text.replace(ESCAPED_DOLLAR_RE, (_m, bs: string) => map(bs));
}

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
  return mapEscapedDollars(text, (bs) => bs + ESCAPED_DOLLAR_GLYPH);
}

/**
 * Same rewrite as replaceEscapedDollars but substitutes the inert
 * ESCAPED_DOLLAR_PLACEHOLDER instead of the glyph. Used by the HTML render
 * pipeline *before* `marked` so the escape survives parsing in every context
 * (text, link destinations, titles, alt text, raw HTML attributes) without
 * injecting markup that would corrupt non-text contexts. The matching
 * `restoreEscapedDollarsInHtml` turns the placeholder back into the glyph span
 * (text) or ASCII `$` (attributes) after sanitization.
 */
export function maskEscapedDollars(text: string): string {
  return mapEscapedDollars(text, (bs) => bs + ESCAPED_DOLLAR_PLACEHOLDER);
}

function hasCodeOrPreAncestor(node: Text): boolean {
  let el = node.parentElement;
  while (el) {
    const tag = el.tagName;
    if (tag === "CODE" || tag === "PRE") return true;
    el = el.parentElement;
  }
  return false;
}

/**
 * Context-aware restore of ESCAPED_DOLLAR_PLACEHOLDER in sanitized HTML:
 * - attributes (href, src, title, alt, ...): placeholder -> ASCII `$`
 *   (CommonMark escape semantics; the ASCII dollar also covers the
 *   percent-encoded form `marked` emits in destinations).
 * - text nodes outside CODE/PRE: placeholder -> `<span class="md-escaped-dollar">＄</span>`.
 * Runs before math placeholders are restored so math HTML is never walked.
 */
export function restoreEscapedDollarsInHtml(html: string): string {
  if (
    !html.includes(ESCAPED_DOLLAR_PLACEHOLDER) &&
    !html.includes(ESCAPED_DOLLAR_PLACEHOLDER_ENCODED)
  ) {
    return html;
  }

  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const restored = attr.value
        .split(ESCAPED_DOLLAR_PLACEHOLDER_ENCODED)
        .join("$")
        .split(ESCAPED_DOLLAR_PLACEHOLDER)
        .join("$");
      if (restored !== attr.value) attr.value = restored;
    }
  }

  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);

  for (const node of textNodes) {
    const value = node.nodeValue;
    if (!value || !value.includes(ESCAPED_DOLLAR_PLACEHOLDER)) continue;
    if (hasCodeOrPreAncestor(node)) continue;
    const parent = node.parentNode;
    if (!parent) continue;

    const parts = value.split(ESCAPED_DOLLAR_PLACEHOLDER);
    const frag = doc.createDocumentFragment();
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) {
        const span = doc.createElement("span");
        span.className = ESCAPED_DOLLAR_HTML_CLASS;
        span.textContent = ESCAPED_DOLLAR_GLYPH;
        frag.appendChild(span);
      }
      if (parts[i]) {
        const part = parts[i];
        if (part) frag.appendChild(doc.createTextNode(part));
      }
    }
    parent.replaceChild(frag, node);
  }

  return doc.body.innerHTML;
}
