import DOMPurify from "dompurify";
import { getKatexSync } from "../editor/livePreview/katexLoader";
import { escapeHtml } from "./escapeHtml";

export function renderMathToHtml(latex: string, displayMode: boolean): string {
  const tag = displayMode ? "div" : "span";
  const cls = displayMode ? "cm-preview-math-display" : "cm-preview-math-inline";
  const katex = getKatexSync();
  if (katex) {
    try {
      const rendered = katex.renderToString(latex, { throwOnError: false, displayMode });
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
