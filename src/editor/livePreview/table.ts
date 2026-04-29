import { getKatexSync } from "./katexLoader";
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
    const katex = getKatexSync();
    if (katex) {
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
    } else {
      placeholders.push(
        `<span class="cm-preview-math-inline cm-preview-math-placeholder">${escapeHtml(latex)}</span>`,
      );
    }
    return `￰PH${idx}￰`;
  });

  // Pass 2: HTML-escape text segments between placeholders
  working = escapeSegments(working);

  // Pass 3: apply inline transforms
  // Wikilinks: [[Page#Section|Display]], [[Page|Display]], [[Page#Section]], [[Page]], [[#Section]]
  working = working.replace(
    /\[\[([^\]|]+)\|([^\]]+)\]\]/g,
    (_, raw, display) => {
      const hashIdx = raw.indexOf("#");
      const target = hashIdx >= 0 ? raw.substring(0, hashIdx) : raw;
      const section = hashIdx >= 0 ? raw.substring(hashIdx + 1) : null;
      let attrs = ` data-wikilink-target="${target}"`;
      if (section !== null) attrs += ` data-wikilink-section="${section}"`;
      return `<span class="cm-preview-wikilink"${attrs}>${display}</span>`;
    },
  );
  working = working.replace(
    /\[\[([^\]]+)\]\]/g,
    (_, page) => {
      const hashIdx = page.indexOf("#");
      const target = hashIdx >= 0 ? page.substring(0, hashIdx) : page;
      const section = hashIdx >= 0 ? page.substring(hashIdx + 1) : null;
      let attrs = ` data-wikilink-target="${target}"`;
      if (section !== null) attrs += ` data-wikilink-section="${section}"`;
      return `<span class="cm-preview-wikilink"${attrs}>${page}</span>`;
    },
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

export function getCellPosition(
  tableText: string,
  from: number,
  row: number,
  col: number,
): number {
  const lines = tableText.split("\n");
  const rawLineIndex = row === 0 ? 0 : row + 1;
  if (rawLineIndex >= lines.length) return from;

  let lineOffset = 0;
  for (let i = 0; i < rawLineIndex; i++) {
    lineOffset += lines[i]!.length + 1;
  }

  const line = lines[rawLineIndex]!;
  const hasLeadingPipe = line.trimStart().startsWith("|");

  let pos = 0;
  if (hasLeadingPipe) {
    pos = line.indexOf("|") + 1;
    for (let c = 0; c < col; c++) {
      pos = line.indexOf("|", pos) + 1;
    }
  } else {
    for (let c = 0; c < col; c++) {
      pos = line.indexOf("|", pos) + 1;
    }
  }

  const cellStart = pos;
  while (pos < line.length && line[pos] === " ") pos++;
  if (pos >= line.length || line[pos] === "|") pos = cellStart;

  return from + lineOffset + pos;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").trim();
}

function alignmentToDelimiter(a: Alignment): string {
  if (a === "left") return ":---";
  if (a === "right") return "---:";
  if (a === "center") return ":---:";
  return "---";
}

export function serializeTable(data: ParsedTable): string {
  const headerLine = `| ${data.headers.map(escapeCell).join(" | ")} |`;
  const delimiterLine = `| ${data.alignments.map(alignmentToDelimiter).join(" | ")} |`;
  const rowLines = data.rows.map(
    (row) => `| ${row.map(escapeCell).join(" | ")} |`,
  );
  return [headerLine, delimiterLine, ...rowLines].join("\n");
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
