const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const collator = new Intl.Collator(undefined, { sensitivity: "base" });

export function toGraphemes(s: string): string[] {
  return [...segmenter.segment(s)].map((seg) => seg.segment);
}

export function graphemeEquals(a: string, b: string): boolean {
  return collator.compare(a, b) === 0;
}

export function localeIncludes(haystack: string, needle: string): boolean {
  if (needle === "") return true;
  const hGraphemes = toGraphemes(haystack);
  const nGraphemes = toGraphemes(needle);
  if (nGraphemes.length > hGraphemes.length) return false;
  for (let i = 0; i <= hGraphemes.length - nGraphemes.length; i++) {
    let match = true;
    for (let j = 0; j < nGraphemes.length; j++) {
      if (!graphemeEquals(hGraphemes[i + j]!, nGraphemes[j]!)) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export function localeIndexOf(haystack: string, needle: string): { start: number; end: number } | null {
  if (needle === "") return { start: 0, end: 0 };
  const hSegments = [...segmenter.segment(haystack)];
  const nGraphemes = toGraphemes(needle);
  if (nGraphemes.length > hSegments.length) return null;
  for (let i = 0; i <= hSegments.length - nGraphemes.length; i++) {
    let match = true;
    for (let j = 0; j < nGraphemes.length; j++) {
      if (!graphemeEquals(hSegments[i + j]!.segment, nGraphemes[j]!)) {
        match = false;
        break;
      }
    }
    if (match) {
      const start = hSegments[i]!.index;
      const lastSeg = hSegments[i + nGraphemes.length - 1]!;
      const end = lastSeg.index + lastSeg.segment.length;
      return { start, end };
    }
  }
  return null;
}
