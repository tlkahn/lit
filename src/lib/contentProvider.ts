import { searchContent } from "./ipc";
import { navigateToNote } from "./navigateToNote";
import type { PaletteProvider, PaletteResult } from "./paletteRegistry";

const SNIPPET_HIGHLIGHT_RE = /<\/?mark>/g;

function stripMarkTags(s: string): string {
  return s.replace(SNIPPET_HIGHLIGHT_RE, "");
}

export const contentProvider: PaletteProvider = {
  id: "content",
  prefix: "/",
  label: "Content",
  priority: 40,
  omniMode: "include",

  async search(query: string): Promise<PaletteResult[]> {
    if (!query) return [];
    const results = await searchContent(query);
    return results.map((r) => ({
      id: `content-${r.id}`,
      title: r.title,
      subtitle: `${r.id} — ${stripMarkTags(r.excerpt)}`,
      icon: "",
      section: "Content",
      data: { path: r.id, line: r.first_match_line },
    }));
  },

  onSelect(result: PaletteResult): void {
    const data = result.data as { path: string; line?: number };
    navigateToNote(data.path, data.line ?? 1);
  },
};
