export interface BlockAnchor {
  id: string;
  /** 1-based line number, matching Rust `BlockAnchorInfo.line` and CM6 `Line.number`. */
  line: number;
  from: number;
  to: number;
}

const ANCHOR_RE = /(?:^|\s)\^([A-Za-z0-9-]+)[ \t]*$/;
const FENCE_RE = /^(`{3,}|~{3,})/;

export function findBlockAnchor(body: string, id: string): BlockAnchor | null {
  const lower = id.toLowerCase();
  return extractBlockAnchors(body).find((a) => a.id.toLowerCase() === lower) ?? null;
}

export function extractBlockAnchors(body: string): BlockAnchor[] {
  if (!body) return [];
  const lines = body.split("\n");
  const anchors: BlockAnchor[] = [];
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

    const match = ANCHOR_RE.exec(line);
    if (match) {
      const id = match[1]!;
      const caretInLine = match.index + (match[0]!.startsWith("^") ? 0 : 1);
      anchors.push({
        id,
        line: i + 1,
        from: offset + caretInLine,
        to: offset + caretInLine + 1 + id.length,
      });
    }
    offset += line.length + 1;
  }

  return anchors;
}
