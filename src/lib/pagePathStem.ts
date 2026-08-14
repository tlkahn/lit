/**
 * Last path segment without its extension. Shared by the Anki cardbox
 * export builder and flow for save-dialog default names and deck-name
 * fallbacks. Mirrors the HTML cardbox export's stem rule (last-dot only,
 * so dotfile-style bases like `.gitignore` stay whole).
 */
export function pagePathStem(pagePath: string): string {
  const base = pagePath.split("/").pop() ?? pagePath;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
