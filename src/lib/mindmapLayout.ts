export const NODE_PADDING = 16;
export const MIN_NODE_WIDTH = 80;
export const MAX_NODE_WIDTH = 300;
export const LINE_HEIGHT_RATIO = 1.3;

const AVG_CHAR_WIDTH_RATIO = 0.6;

function isFullWidth(code: number): boolean {
  return (
    (code >= 0x2e80 && code <= 0x303f) ||
    (code >= 0x3040 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff01 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function charWidth(code: number, fontSize: number): number {
  return isFullWidth(code) ? fontSize : fontSize * AVG_CHAR_WIDTH_RATIO;
}

export function estimateTextWidth(text: string, fontSize: number): number {
  let w = 0;
  for (let i = 0; i < text.length; i++) {
    w += charWidth(text.charCodeAt(i), fontSize);
  }
  return w;
}

export function computeNodeWidth(text: string, fontSize: number): number {
  const textW = estimateTextWidth(text, fontSize);
  return Math.max(MIN_NODE_WIDTH, Math.min(Math.ceil(textW + NODE_PADDING), MAX_NODE_WIDTH));
}

export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  if (text === "") return [""];
  const maxTextWidth = maxWidth - NODE_PADDING;

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (estimateTextWidth(word, fontSize) > maxTextWidth) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = "";
      }
      const chunks = breakLongWord(word, fontSize, maxTextWidth);
      for (let i = 0; i < chunks.length; i++) {
        if (i < chunks.length - 1) {
          lines.push(chunks[i]!);
        } else {
          currentLine = chunks[i]!;
        }
      }
    } else if (currentLine === "") {
      currentLine = word;
    } else {
      const candidate = currentLine + " " + word;
      if (estimateTextWidth(candidate, fontSize) <= maxTextWidth) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function breakLongWord(word: string, fontSize: number, maxTextWidth: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  let w = 0;
  for (let i = 0; i < word.length; i++) {
    const cw = charWidth(word.charCodeAt(i), fontSize);
    if (w + cw > maxTextWidth && i > start) {
      chunks.push(word.slice(start, i));
      start = i;
      w = cw;
    } else {
      w += cw;
    }
  }
  if (start < word.length) {
    chunks.push(word.slice(start));
  }
  return chunks;
}

export function computeNodeHeight(lineCount: number, fontSize: number): number {
  return (lineCount - 1) * Math.ceil(fontSize * LINE_HEIGHT_RATIO) + fontSize + 8;
}
