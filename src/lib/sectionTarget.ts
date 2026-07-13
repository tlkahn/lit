import { extractHeadings } from "./headings";
import { findBlockAnchor } from "./blockAnchors";

export interface SectionTarget {
  pos: number;
  flash: { from: number; to: number } | null;
}

export function resolvePendingSection(
  docText: string,
  section: string,
): SectionTarget | null {
  if (section.startsWith("^")) {
    const anchor = findBlockAnchor(docText, section.slice(1));
    if (!anchor) return null;
    const lineStart = docText.lastIndexOf("\n", anchor.from - 1) + 1;
    const newlineAfter = docText.indexOf("\n", anchor.from);
    const lineEnd = newlineAfter === -1 ? docText.length : newlineAfter;
    return { pos: lineStart, flash: { from: lineStart, to: lineEnd } };
  }

  const match = extractHeadings(docText).find(
    (h) => h.text.toLowerCase() === section.toLowerCase(),
  );
  if (!match) return null;
  return { pos: match.from, flash: null };
}
