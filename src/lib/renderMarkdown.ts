import { marked, Marked } from "marked";
import DOMPurify from "dompurify";
import { renderMathToHtml, replaceInlineMath } from "./renderMath";
import { litFootnoteExtension } from "./markedFootnote";
import { replaceEscapedDollarsHtml } from "./escapedDollar";

// Dedicated instance so the footnote extension never leaks into other callers
// of the global `marked` (e.g. table cell rendering).
const litMarked = new Marked();
litMarked.use(litFootnoteExtension());
litMarked.use({
  renderer: {
    link({ href, title, text }) {
      const titleAttr = title ? ` title="${title}"` : "";
      return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    hr({ raw }) {
      const short = raw.replace(/\s/g, "") === "---";
      return short
        ? '<hr class="md-hr md-hr-short">\n'
        : '<hr class="md-hr">\n';
    },
  },
});

interface MathExtraction {
  processed: string;
  placeholders: string[];
}

function extractAndRenderMath(text: string, stripFootnotes = false): MathExtraction {
  const codePlaceholders: string[] = [];
  const placeholders: string[] = [];
  let working = text;

  working = working.replace(/(?:```|~~~)[\s\S]*?(?:```|~~~)/g, (match) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(match);
    return `￰CODEPH${idx}￰`;
  });

  working = working.replace(/``(?:[^`]|`(?!`))+``/g, (match) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(match);
    return `￰CODEPH${idx}￰`;
  });

  working = working.replace(/`[^`]*`/g, (match) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(match);
    return `￰CODEPH${idx}￰`;
  });

  working = working.replace(/\$\$([\s\S]+?)\$\$[ \t]*(?:\{#[a-z]+:[^}]+\})?/g, (_, latex) => {
    const idx = placeholders.length;
    placeholders.push(renderMathToHtml(latex, true));
    return `￰MATHPH${idx}￰`;
  });

  // Single-line display math: \[ at line start, first \] closes,
  // nothing (or only a {#type:id} label) after close — mirrors editor grammar.
  working = working.replace(/^\\\[.+$/gm, (match) => {
    const closeIdx = match.indexOf('\\]', 2);
    if (closeIdx <= 2) return match;
    const afterClose = match.slice(closeIdx + 2).trim();
    if (afterClose !== '' && !/^\{#[a-z]+:[^}]+\}$/.test(afterClose)) return match;
    const latex = match.slice(2, closeIdx);
    const idx = placeholders.length;
    placeholders.push(renderMathToHtml(latex, true));
    return `￰MATHPH${idx}￰`;
  });

  // Multi-line display math: \[ alone on its line, \] at end of a line
  working = working.replace(/^\\\[\s*\n([\s\S]+?)\\\][ \t]*(?:\{#[a-z]+:[^}]+\})?[ \t]*$/gm, (_, latex) => {
    const idx = placeholders.length;
    placeholders.push(renderMathToHtml(latex, true));
    return `￰MATHPH${idx}￰`;
  });

  working = replaceInlineMath(working, (latex) => {
    const idx = placeholders.length;
    placeholders.push(renderMathToHtml(latex, false));
    return `￰MATHPH${idx}￰`;
  });

  // Must run while code spans are still masked so `[^1]` inside inline code
  // stays untouched.
  if (stripFootnotes) working = footnotesToInlineMarkers(working);

  // Rewrite CommonMark dollar-escapes to the fullwidth stand-in. Runs after
  // code masking + math extraction so `` `\$` `` / fenced `\$` and math keep
  // their source, and before marked so it never resolves those `\$` to ASCII
  // `$`. Backslash runs before the escape (`\\$`) are preserved.
  working = replaceEscapedDollarsHtml(working);

  working = working.replace(/￰CODEPH(\d+)￰/g, (_, idx) => codePlaceholders[Number(idx)]!);

  return { processed: working, placeholders };
}

// Pill-style footnote handling for inline rendering: drop definition lines
// (with their indented continuations) and replace refs with plain numbered
// superscript markers in first-appearance order.
function footnotesToInlineMarkers(text: string): string {
  let working = text.replace(/^\[\^[^\]\n]+\]:[^\n]*(?:\n+(?:[ ]{4,}|\t)[^\n]*)*(?:\n|$)/gm, "");
  const order = new Map<string, number>();
  working = working.replace(/\[\^([^\]\n]+)\]/g, (_, label: string) => {
    let n = order.get(label);
    if (n === undefined) {
      n = order.size + 1;
      order.set(label, n);
    }
    return `<sup class="footnote-ref">${n}</sup>`;
  });
  return working;
}

function restorePlaceholders(html: string, placeholders: string[]): string {
  return html.replace(/￰MATHPH(\d+)￰/g, (_, idx) => placeholders[Number(idx)]!);
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const { processed, placeholders } = extractAndRenderMath(text);
  const html = litMarked.parse(processed, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
  return restorePlaceholders(sanitized, placeholders);
}

export function renderInlineMarkdown(text: string): string {
  if (!text) return "";
  const { processed, placeholders } = extractAndRenderMath(text, true);
  const html = marked.parseInline(processed, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(html);
  return restorePlaceholders(sanitized, placeholders);
}
