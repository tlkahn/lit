import { marked, Renderer } from "marked";
import DOMPurify from "dompurify";

const renderer = new Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : "";
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

export function renderMarkdown(text: string): string {
  if (!text) return "";
  const html = marked.parse(text, { async: false, renderer }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ["target"] });
}

export function renderInlineMarkdown(text: string): string {
  if (!text) return "";
  return DOMPurify.sanitize(marked.parseInline(text, { async: false }) as string);
}
