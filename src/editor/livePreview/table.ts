import katex from "katex";
import "katex/dist/katex.min.css";

export type Alignment = "left" | "right" | "center" | "default";

export interface ParsedTable {
  headers: string[];
  alignments: Alignment[];
  rows: string[][];
}

function parseCells(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((c) => c.trim());
}

const DELIMITER_RE = /^\s*:?-+:?\s*$/;

export function parseTableAlignment(delimiterLine: string): Alignment[] {
  return parseCells(delimiterLine).map((cell) => {
    const t = cell.trim();
    const left = t.startsWith(":");
    const right = t.endsWith(":");
    if (left && right) return "center";
    if (left) return "left";
    if (right) return "right";
    return "default";
  });
}

export function parseTable(text: string): ParsedTable | null {
  const lines = text.split("\n");
  if (lines.length < 2) return null;

  const delimiterCells = parseCells(lines[1]!);
  if (!delimiterCells.every((c) => DELIMITER_RE.test(c))) return null;

  const headers = parseCells(lines[0]!);
  const alignments = parseTableAlignment(lines[1]!);
  const colCount = headers.length;

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = parseCells(lines[i]!);
    while (cells.length < colCount) cells.push("");
    rows.push(cells.slice(0, colCount));
  }

  return { headers, alignments, rows };
}

export function renderInlineMarkdown(text: string): string {
  if (text === "") return "";

  // Pass 1: extract atomic spans (code, math) into placeholders
  const placeholders: string[] = [];
  let working = text;

  // Inline code
  working = working.replace(/`([^`]*)`/g, (_, content) => {
    const idx = placeholders.length;
    placeholders.push(`<code>${escapeHtml(content)}</code>`);
    return `￰PH${idx}￰`;
  });

  // Inline math
  working = working.replace(/\$([^$]+)\$/g, (_, latex) => {
    const idx = placeholders.length;
    try {
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
      });
      placeholders.push(`<span class="cm-preview-math-inline">${html}</span>`);
    } catch {
      placeholders.push(
        `<span class="cm-preview-math-inline cm-preview-math-error">${escapeHtml(latex)}</span>`,
      );
    }
    return `￰PH${idx}￰`;
  });

  // Pass 2: HTML-escape text segments between placeholders
  working = escapeSegments(working);

  // Pass 3: apply inline transforms
  // Wikilinks: [[Page|Display]] or [[Page]]
  working = working.replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
    (_, _page, display) =>
      `<span class="cm-preview-wikilink">${display}</span>`,
  );
  working = working.replace(
    /\[\[([^\]]+)\]\]/g,
    (_, page) => `<span class="cm-preview-wikilink">${page}</span>`,
  );

  // Links: [text](url)
  working = working.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, linkText, url) =>
      `<a href="${url}" class="cm-preview-link">${linkText}</a>`,
  );

  // Bold: **text** or __text__
  working = working.replace(
    /\*\*(.+?)\*\*/g,
    (_, content) => `<strong>${content}</strong>`,
  );
  working = working.replace(
    /__(.+?)__/g,
    (_, content) => `<strong>${content}</strong>`,
  );

  // Italic: *text* or _text_
  working = working.replace(
    /\*(.+?)\*/g,
    (_, content) => `<em>${content}</em>`,
  );
  working = working.replace(
    /_(.+?)_/g,
    (_, content) => `<em>${content}</em>`,
  );

  // Pass 4: re-insert placeholders
  working = working.replace(/￰PH(\d+)￰/g, (_, idx) => placeholders[Number(idx)]!);

  return working;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeSegments(text: string): string {
  const parts = text.split(/(￰PH\d+￰)/);
  return parts
    .map((part) => {
      if (/^￰PH\d+￰$/.test(part)) return part;
      return escapeHtml(part);
    })
    .join("");
}
