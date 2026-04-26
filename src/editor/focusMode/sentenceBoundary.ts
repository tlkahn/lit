export interface SentenceRange {
  from: number;
  to: number;
}

const ABBREVIATIONS = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|al|fig|vol|no|op|ch|p|pp)$/i;

function isListLine(line: string): boolean {
  return /^(\s*[-*+]|\s*\d+[.)]) /.test(line);
}

function isHeadingLine(line: string): boolean {
  return /^#{1,6} /.test(line);
}

function isCodeFenceStart(line: string): boolean {
  return /^(`{3,}|~{3,})/.test(line);
}

interface Block {
  from: number;
  to: number;
  kind: "paragraph" | "heading" | "listitem" | "codefence";
  text: string;
}

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let offset = 0;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === "") {
      offset += line.length + 1;
      i++;
      continue;
    }

    if (isCodeFenceStart(line)) {
      const fenceMatch = line.match(/^(`{3,}|~{3,})/)!;
      const fence = fenceMatch[1]!;
      const blockStart = offset;
      offset += line.length + 1;
      i++;
      while (i < lines.length) {
        const fLine = lines[i]!;
        offset += fLine.length + 1;
        i++;
        if (fLine.startsWith(fence.charAt(0).repeat(fence.length)) && fLine.trim().length <= fence.length + 1) {
          break;
        }
      }
      blocks.push({ from: blockStart, to: offset - 1, kind: "codefence", text: text.slice(blockStart, offset - 1) });
      continue;
    }

    if (isHeadingLine(line)) {
      blocks.push({ from: offset, to: offset + line.length, kind: "heading", text: line });
      offset += line.length + 1;
      i++;
      continue;
    }

    if (isListLine(line)) {
      const listMatch = line.match(/^(\s*[-*+]|\s*\d+[.)]) /)!;
      const contentStart = offset + listMatch[0]!.length;
      blocks.push({ from: contentStart, to: offset + line.length, kind: "listitem", text: line.slice(listMatch[0]!.length) });
      offset += line.length + 1;
      i++;
      continue;
    }

    const paraStart = offset;
    while (i < lines.length && lines[i]!.trim() !== "" && !isHeadingLine(lines[i]!) && !isCodeFenceStart(lines[i]!) && !isListLine(lines[i]!)) {
      offset += lines[i]!.length + 1;
      i++;
    }
    const paraEnd = offset - 1;
    blocks.push({ from: paraStart, to: paraEnd, kind: "paragraph", text: text.slice(paraStart, paraEnd) });
  }

  return blocks;
}

function splitSentences(blockText: string, blockFrom: number): SentenceRange[] {
  if (blockText.length === 0) return [{ from: blockFrom, to: blockFrom }];

  const ranges: SentenceRange[] = [];
  const re = /([.!?])(\s+)/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(blockText)) !== null) {
    const punctIdx = match.index;
    const afterSpace = match.index + match[0].length;

    const beforePunct = blockText.slice(0, punctIdx);
    if (ABBREVIATIONS.test(beforePunct)) continue;

    if (blockText[punctIdx] === "." && punctIdx >= 2 && blockText[punctIdx - 1] === "." && blockText[punctIdx - 2] === ".") continue;

    const nextChar = blockText[afterSpace];
    if (nextChar && nextChar === nextChar.toLowerCase() && nextChar !== nextChar.toUpperCase()) continue;

    ranges.push({ from: blockFrom + lastEnd, to: blockFrom + punctIdx + 1 });
    lastEnd = afterSpace;
  }

  ranges.push({ from: blockFrom + lastEnd, to: blockFrom + blockText.length });
  return ranges;
}

export function findSentenceAt(text: string, pos: number): SentenceRange {
  if (text.length === 0) return { from: 0, to: 0 };

  pos = Math.max(0, Math.min(pos, text.length));

  const blocks = parseBlocks(text);
  if (blocks.length === 0) return { from: 0, to: text.length };

  let containingBlock: Block | undefined;
  for (const block of blocks) {
    if (pos >= block.from && pos <= block.to) {
      containingBlock = block;
      break;
    }
  }

  if (!containingBlock) {
    let best = blocks[0]!;
    let bestDist = Infinity;
    for (const block of blocks) {
      const dist = pos < block.from ? block.from - pos : pos - block.to;
      if (dist < bestDist) {
        bestDist = dist;
        best = block;
      }
    }
    containingBlock = best;
  }

  if (containingBlock.kind === "codefence" || containingBlock.kind === "heading") {
    return { from: containingBlock.from, to: containingBlock.to };
  }

  const sentences = splitSentences(containingBlock.text, containingBlock.from);
  for (const s of sentences) {
    if (pos >= s.from && pos <= s.to) return s;
  }

  return sentences[sentences.length - 1]!;
}
