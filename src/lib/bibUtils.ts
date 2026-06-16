import type { BibEntry } from "./ipc";

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
