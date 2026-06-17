import type { BibEntry } from "./ipc";

/**
 * Abbreviate an author list for compact display:
 * 1 author  → "Smith"
 * 2 authors → "Smith & Jones"
 * 3+        → "Smith et al."
 */
export function abbreviateAuthors(authors: string[]): string {
  if (authors.length === 0) return "";
  if (authors.length === 1) return authors[0]!;
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors[0]} et al.`;
}

/**
 * Returns the publisher string when it is meaningfully distinct from the
 * journal, or `undefined` when it should be suppressed (absent, empty, or
 * equivalent after trim + case-fold).
 */
export function distinctPublisher(entry: BibEntry): string | undefined {
  const pub = entry.publisher?.trim();
  if (!pub) return undefined;
  const jour = entry.journal?.trim();
  if (jour && pub.toLowerCase() === jour.toLowerCase()) return undefined;
  return pub;
}
