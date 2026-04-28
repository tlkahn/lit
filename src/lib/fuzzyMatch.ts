import { toGraphemes, graphemeEquals } from "./localeSearch";

export interface FuzzyMatchResult {
  score: number;
  indices: number[];
}

const WORD_SEPARATORS = new Set([" ", "_", "-", "/", "."]);

function isWordBoundary(graphemes: string[], i: number): boolean {
  if (i === 0) return true;
  return WORD_SEPARATORS.has(graphemes[i - 1]!);
}

export function fuzzyMatch(query: string, candidate: string): FuzzyMatchResult | null {
  const qGraphemes = toGraphemes(query);
  const cGraphemes = toGraphemes(candidate);

  if (qGraphemes.length === 0) return { score: 0, indices: [] };
  if (qGraphemes.length > cGraphemes.length) return null;

  const indices: number[] = [];
  let qi = 0;
  for (let ci = 0; ci < cGraphemes.length && qi < qGraphemes.length; ci++) {
    if (graphemeEquals(cGraphemes[ci]!, qGraphemes[qi]!)) {
      indices.push(ci);
      qi++;
    }
  }

  if (qi < qGraphemes.length) return null;

  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]!;

    if (i > 0 && idx === indices[i - 1]! + 1) {
      score += 4;
    } else {
      score += 1;
    }

    if (isWordBoundary(cGraphemes, idx)) {
      score += 3;
    }

    if (cGraphemes[idx] === qGraphemes[i]) {
      score += 1;
    }
  }

  if (indices.length > 0 && indices[0] === 0) {
    score += 2;
  }

  return { score, indices };
}
