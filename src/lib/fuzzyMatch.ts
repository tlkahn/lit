export interface FuzzyMatchResult {
  score: number;
  indices: number[];
}

const WORD_SEPARATORS = new Set([" ", "_", "-", "/", "."]);

function isWordBoundary(candidate: string, i: number): boolean {
  if (i === 0) return true;
  return WORD_SEPARATORS.has(candidate[i - 1]!);
}

export function fuzzyMatch(query: string, candidate: string): FuzzyMatchResult | null {
  if (query.length === 0) return { score: 0, indices: [] };
  if (query.length > candidate.length) return null;

  const queryLower = query.toLowerCase();
  const candidateLower = candidate.toLowerCase();

  const indices: number[] = [];
  let qi = 0;
  for (let ci = 0; ci < candidateLower.length && qi < queryLower.length; ci++) {
    if (candidateLower[ci] === queryLower[qi]) {
      indices.push(ci);
      qi++;
    }
  }

  if (qi < queryLower.length) return null;

  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]!;

    // Consecutive bonus
    if (i > 0 && idx === indices[i - 1]! + 1) {
      score += 4;
    } else {
      score += 1;
    }

    // Word boundary bonus
    if (isWordBoundary(candidate, idx)) {
      score += 3;
    }

    // Case-exact bonus
    if (candidate[idx] === query[i]) {
      score += 1;
    }
  }

  // Start-of-string bonus
  if (indices.length > 0 && indices[0] === 0) {
    score += 2;
  }

  return { score, indices };
}
