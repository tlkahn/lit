const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export function toGraphemes(s: string): string[] {
  return [...segmenter.segment(s)].map((seg) => seg.segment);
}

export function graphemeEquals(a: string, b: string): boolean {
  return collator.compare(a, b) === 0;
}

function matchesGraphemes(hGraphemes: string[], nGraphemes: string[], startIndex: number): boolean {
  for (let j = 0; j < nGraphemes.length; j++) {
    if (!graphemeEquals(hGraphemes[startIndex + j]!, nGraphemes[j]!)) return false;
  }
  return true;
}

export function localeIncludes(haystack: string, needle: string): boolean {
  if (needle === "") return true;
  const hGraphemes = toGraphemes(haystack);
  const nGraphemes = toGraphemes(needle);
  if (nGraphemes.length > hGraphemes.length) return false;
  for (let i = 0; i <= hGraphemes.length - nGraphemes.length; i++) {
    if (matchesGraphemes(hGraphemes, nGraphemes, i)) return true;
  }
  return false;
}

export function localeFilter<T>(items: T[], needle: string, getText: (item: T) => string): T[] {
  if (needle === "") return items;
  const nGraphemes = toGraphemes(needle);
  return items.filter((item) => {
    const hGraphemes = toGraphemes(getText(item));
    if (nGraphemes.length > hGraphemes.length) return false;
    for (let i = 0; i <= hGraphemes.length - nGraphemes.length; i++) {
      if (matchesGraphemes(hGraphemes, nGraphemes, i)) return true;
    }
    return false;
  });
}

export function localeIndexOf(haystack: string, needle: string): { start: number; end: number } | null {
  if (needle === "") return { start: 0, end: 0 };
  const hSegments = [...segmenter.segment(haystack)];
  const nGraphemes = toGraphemes(needle);
  if (nGraphemes.length > hSegments.length) return null;
  const hGraphemes = hSegments.map((s) => s.segment);
  for (let i = 0; i <= hSegments.length - nGraphemes.length; i++) {
    if (matchesGraphemes(hGraphemes, nGraphemes, i)) {
      const start = hSegments[i]!.index;
      const lastSeg = hSegments[i + nGraphemes.length - 1]!;
      const end = lastSeg.index + lastSeg.segment.length;
      return { start, end };
    }
  }
  return null;
}
