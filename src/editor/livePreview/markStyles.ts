import type { MarkConfig } from "../../lib/ipc";

// Single dynamic stylesheet for custom / overridden philological marks.
// Appended to <head> AFTER the bundled annotation.css (side-effect imported by
// annotationWidgets.ts), so its rules win at equal specificity for any code the
// user customizes via .lit/marks.toml.
const STYLE_ID = "lit-mark-styles";

// Allowlists that reject malformed `.lit/marks.toml` config so it cannot inject
// arbitrary CSS. The property name must be a plain CSS identifier (letters and
// hyphens); the value may contain spaces, parentheses, #, commas, colons, etc.
// but must NOT contain the metacharacters that could close the declaration /
// block or break out of a value: `{`, `}`, `;`, `"`.
const CSS_PROP_RE = /^[a-z-]+$/i;
const CSS_VALUE_RE = /^[^{};"\\\n]+$/;
// eslint-disable-next-line no-control-regex
const CSS_CONTENT_RE = /^[^\x00-\x08\x0b-\x1f]+$/;

// Escape a string for use inside a CSS `content: "…"` value: backslashes,
// double-quotes, and newlines would otherwise break out of (or invalidate) the
// declaration.
function cssEscapeContent(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\A ");
}

// Build the CSS text for a loaded mark config. Pure — no DOM access.
// Per code, emits a `.cm-mark-{code}` block from the `style` table plus
// `::before` / `::after` content rules. Codes with no style/before/after are
// skipped (their built-in static CSS, if any, already covers them).
export function buildMarkStylesCss(config: MarkConfig): string {
  const blocks: string[] = [];

  for (const [code, def] of Object.entries(config)) {
    const styleEntries = def.style ? Object.entries(def.style) : [];
    // Drop any entry whose property name or value fails the allowlist so
    // malformed config can't inject CSS.
    const validStyleEntries = styleEntries.filter(
      ([prop, value]) => CSS_PROP_RE.test(prop) && CSS_VALUE_RE.test(value),
    );
    const hasStyle = validStyleEntries.length > 0;
    const hasBefore = def.before != null && CSS_CONTENT_RE.test(def.before);
    const hasAfter = def.after != null && CSS_CONTENT_RE.test(def.after);
    if (!hasStyle && !hasBefore && !hasAfter) continue;

    // Escape the user-supplied code so CSS metacharacters can't break the
    // selector or inject extra rules.
    const safeCode = CSS.escape(code);

    if (hasStyle) {
      const decls = validStyleEntries
        .map(([prop, value]) => `  ${prop}: ${value};`)
        .join("\n");
      blocks.push(`.cm-mark-${safeCode} {\n${decls}\n}`);
    }
    if (hasBefore) {
      blocks.push(
        `.cm-mark-${safeCode}::before {\n  content: "${cssEscapeContent(def.before!)}";\n}`,
      );
    }
    if (hasAfter) {
      blocks.push(
        `.cm-mark-${safeCode}::after {\n  content: "${cssEscapeContent(def.after!)}";\n}`,
      );
    }
  }

  return blocks.join("\n\n");
}

// Idempotently create-or-update the single <style id="lit-mark-styles"> in
// <head> with CSS generated from `config`.
export function injectMarkStyles(config: MarkConfig): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildMarkStylesCss(config);
}
