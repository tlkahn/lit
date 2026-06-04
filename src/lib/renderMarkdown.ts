import { marked, Renderer } from "marked";
import DOMPurify from "dompurify";
import { getKatexSync } from "../editor/livePreview/katexLoader";

const renderer = new Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : "";
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

interface MathExtraction {
  processed: string;
  placeholders: string[];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderMathToken(
  latex: string,
  displayMode: boolean,
): string {
  const tag = displayMode ? "div" : "span";
  const cls = displayMode ? "cm-preview-math-display" : "cm-preview-math-inline";
  const katex = getKatexSync();
  if (katex) {
    try {
      const html = katex.renderToString(latex, { throwOnError: false, displayMode });
      return `<${tag} class="${cls}">${html}</${tag}>`;
    } catch {
      return `<${tag} class="${cls} cm-preview-math-error">${escapeHtml(latex)}</${tag}>`;
    }
  }
  return `<${tag} class="${cls} cm-preview-math-placeholder">${escapeHtml(latex)}</${tag}>`;
}

function extractAndRenderMath(text: string): MathExtraction {
  const codePlaceholders: string[] = [];
  const placeholders: string[] = [];
  let working = text;

  // Protect fenced code blocks from math extraction
  working = working.replace(/```[\s\S]*?```/g, (match) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(match);
    return `￰CP${idx}￰`;
  });

  // Protect inline code from math extraction
  working = working.replace(/`[^`]*`/g, (match) => {
    const idx = codePlaceholders.length;
    codePlaceholders.push(match);
    return `￰CP${idx}￰`;
  });

  // Display math ($$...$$) — must come before inline
  working = working.replace(/\$\$([^$]+)\$\$/g, (_, latex) => {
    const idx = placeholders.length;
    placeholders.push(renderMathToken(latex, true));
    return `￰MP${idx}￰`;
  });

  // Inline math ($...$)
  working = working.replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, latex) => {
    const idx = placeholders.length;
    placeholders.push(renderMathToken(latex, false));
    return `￰MP${idx}￰`;
  });

  // Restore code placeholders so marked can process them
  working = working.replace(/￰CP(\d+)￰/g, (_, idx) => codePlaceholders[Number(idx)]!);

  return { processed: working, placeholders };
}

function restorePlaceholders(html: string, placeholders: string[]): string {
  return html.replace(/￰MP(\d+)￰/g, (_, idx) => placeholders[Number(idx)]!);
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const { processed, placeholders } = extractAndRenderMath(text);
  const html = marked.parse(processed, { async: false, renderer }) as string;
  const sanitized = DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
  return restorePlaceholders(sanitized, placeholders);
}

export function renderInlineMarkdown(text: string): string {
  if (!text) return "";
  const { processed, placeholders } = extractAndRenderMath(text);
  const html = marked.parseInline(processed, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(html);
  return restorePlaceholders(sanitized, placeholders);
}
