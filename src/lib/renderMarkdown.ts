import { marked, Renderer } from "marked";
import DOMPurify from "dompurify";
import { renderMathToHtml } from "./renderMath";

const renderer = new Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : "";
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

interface MathExtraction {
  processed: string;
  placeholders: string[];
}

function extractAndRenderMath(text: string): MathExtraction {
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

  working = working.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    const idx = placeholders.length;
    placeholders.push(renderMathToHtml(latex, true));
    return `￰MATHPH${idx}￰`;
  });

  working = working.replace(/(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g, (_, latex) => {
    const idx = placeholders.length;
    placeholders.push(renderMathToHtml(latex, false));
    return `￰MATHPH${idx}￰`;
  });

  working = working.replace(/￰CODEPH(\d+)￰/g, (_, idx) => codePlaceholders[Number(idx)]!);

  return { processed: working, placeholders };
}

function restorePlaceholders(html: string, placeholders: string[]): string {
  return html.replace(/￰MATHPH(\d+)￰/g, (_, idx) => placeholders[Number(idx)]!);
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
