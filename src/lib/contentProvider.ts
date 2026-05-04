import { searchPages } from "./ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import type { PaletteProvider, PaletteResult } from "./paletteRegistry";

export const contentProvider: PaletteProvider = {
  id: "content",
  prefix: "/",
  label: "Content",
  priority: 40,

  async search(query: string): Promise<PaletteResult[]> {
    if (!query) return [];
    const results = await searchPages(query);
    return results.map((r) => {
      const line = r.first_match_line;
      const subtitle = line ? `${r.id}:${line} — ${r.excerpt}` : `${r.id} — ${r.excerpt}`;
      return {
        id: `content-${r.id}`,
        title: r.title,
        subtitle,
        icon: "",
        section: "Content",
        data: { path: r.id, line },
      };
    });
  },

  onSelect(result: PaletteResult): void {
    const data = result.data as { path: string; line?: number };
    const { currentPagePath, selectPageAtLine } = useWorkspaceStore.getState();
    const targetLine = data.line ?? 1;

    globalJumpTracker.recordJump(
      { notePath: currentPagePath ?? "", line: 1, col: 0 },
      { notePath: data.path, line: targetLine, col: 0 },
    );

    if (data.path === currentPagePath) {
      window.dispatchEvent(
        new CustomEvent("lit:scroll-to-line", {
          detail: { line: targetLine, cursor: true },
        }),
      );
    } else {
      selectPageAtLine(data.path, targetLine);
    }
  },
};
