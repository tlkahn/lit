/**
 * Shared URL/DOI helper utilities.
 *
 * Extracted from bibFileLink.ts (isValidHttpUrl, resolveUrlFieldValue),
 * ReferenceLibrary.tsx (doiHref), and YamlHighlighter.tsx (isHttpUrl)
 * to eliminate duplication.
 */

/** Resolve a bare DOI to a full https://doi.org/ URL; pass through if already prefixed.
 *  Trims whitespace and strips a leading `doi:` / `DOI:` prefix before resolving. */
export function doiHref(doi: string): string {
  const cleaned = doi.trim().replace(/^doi:/i, "");
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://doi.org/${cleaned}`;
}

/** Check whether a string is a valid HTTP or HTTPS URL using the URL constructor. */
export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
