export interface Heading {
  level: number;
  text: string;
  line: number;
  from: number;
  to: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const FENCE_RE = /^(`{3,}|~{3,})/;

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")   // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")     // links
    .replace(/\[\[([^|\]]*)\|([^\]]*)\]\]/g, "$2") // aliased wikilinks
    .replace(/\[\[([^\]]*)\]\]/g, "$1")           // plain wikilinks
    .replace(/\*\*(.+?)\*\*/g, "$1")             // bold **
    .replace(/__(.+?)__/g, "$1")                  // bold __
    .replace(/\*(.+?)\*/g, "$1")                  // italic *
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "$1")       // italic _
    .replace(/~~(.+?)~~/g, "$1")                  // strikethrough
    .replace(/==(.+?)==/g, "$1")                   // highlight
    .replace(/`(.+?)`/g, "$1");                   // inline code
}

export function extractHeadings(body: string): Heading[] {
  if (!body) return [];
  const lines = body.split("\n");
  const headings: Heading[] = [];
  let inFence = false;
  let fenceChar = "";
  let offset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const char = fenceMatch[1]![0]!;
      if (!inFence) {
        inFence = true;
        fenceChar = char;
      } else if (char === fenceChar) {
        inFence = false;
      }
      offset += line.length + 1;
      continue;
    }
    if (inFence) {
      offset += line.length + 1;
      continue;
    }

    const match = HEADING_RE.exec(line);
    if (match) {
      headings.push({
        level: match[1]!.length,
        text: stripInlineMarkdown(match[2]!.trim()),
        line: i,
        from: offset,
        to: offset + line.length,
      });
    }
    offset += line.length + 1;
  }

  return headings;
}
