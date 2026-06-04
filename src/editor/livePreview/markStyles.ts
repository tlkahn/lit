import type { MarkConfig } from "../../lib/ipc";

// Single dynamic stylesheet for custom / overridden philological marks.
// Appended to <head> AFTER the bundled annotation.css (side-effect imported by
// annotationWidgets.ts), so its rules win at equal specificity for any code the
// user customizes via .lit/marks.toml.
const STYLE_ID = "lit-mark-styles";

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
    const hasStyle = styleEntries.length > 0;
    const hasBefore = def.before != null;
    const hasAfter = def.after != null;
    if (!hasStyle && !hasBefore && !hasAfter) continue;

    if (hasStyle) {
      const decls = styleEntries
        .map(([prop, value]) => `  ${prop}: ${value};`)
        .join("\n");
      blocks.push(`.cm-mark-${code} {\n${decls}\n}`);
    }
    if (hasBefore) {
      blocks.push(
        `.cm-mark-${code}::before {\n  content: "${cssEscapeContent(def.before!)}";\n}`,
      );
    }
    if (hasAfter) {
      blocks.push(
        `.cm-mark-${code}::after {\n  content: "${cssEscapeContent(def.after!)}";\n}`,
      );
    }
  }

  return blocks.join("\n\n");
}

// Idempotently create-or-update the single <style id="lit-mark-styles"> in
// <head> with CSS generated from `config`. Mirrors themeInjector.injectThemeCss.
export function injectMarkStyles(config: MarkConfig): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = buildMarkStylesCss(config);
}
