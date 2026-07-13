import DOMPurify from "dompurify";
import { getKatexSync } from "../editor/livePreview/katexLoader";
import { escapeHtml } from "./escapeHtml";
import { katexOptions } from "./latexCompat";

/**
 * Replace inline math delimiters ($...$ and \(...\)) in `text`, calling
 * `replacer` with the captured LaTeX content for each match.
 *
 * $...$ runs first so that `$\(x\)$` is captured by dollar-sign delimiters.
 *
 * Tradeoff: \( is treated as math, not a CommonMark escape -- same precedence
 * as Pandoc, MathJax, KaTeX auto-render, Obsidian, Typora.  Users who want
 * literal backslash+paren use \\( (the negative lookbehind excludes it).
 */
export function replaceInlineMath(
  text: string,
  replacer: (latex: string) => string,
): string {
  let result = text.replace(
    /(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g,
    (_, latex) => replacer(latex),
  );
  result = result.replace(
    /(?<!\\)\\\(([^\n]+?)\\\)/g,
    (_, latex) => replacer(latex),
  );
  return result;
}

export function renderMathToHtml(latex: string, displayMode: boolean): string {
  const tag = displayMode ? "div" : "span";
  const cls = displayMode ? "cm-preview-math-display" : "cm-preview-math-inline";
  const katex = getKatexSync();
  if (katex) {
    try {
      const rendered = katex.renderToString(latex, katexOptions(displayMode));
      return DOMPurify.sanitize(`<${tag} class="${cls}">${rendered}</${tag}>`, {
        ADD_TAGS: ["semantics", "annotation", "annotation-xml"],
        ADD_ATTR: ["encoding"],
      });
    } catch {
      return `<${tag} class="${cls} cm-preview-math-error">${escapeHtml(latex)}</${tag}>`;
    }
  }
  return `<${tag} class="${cls} cm-preview-math-placeholder">${escapeHtml(latex)}</${tag}>`;
}
