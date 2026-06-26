import type { BibEntry, BibKeyState } from "./ipc";

export function entryStableKey(entry: BibEntry): string {
  return entry.doi ?? entry.key;
}

/**
 * Returns the border className for a bib entry based on its materialization
 * state: accent border when a note page exists, dashed muted border for
 * partially-enriched entries, or `undefined` for everything else.
 */
export function materializationBorderClass(
  state: BibKeyState | undefined,
): string | undefined {
  if (state?.page_id) return "border-l-2 border-interactive-accent";
  if (state?.materialization === "partial") return "border-l-2 border-dashed border-text-muted";
  return undefined;
}

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
