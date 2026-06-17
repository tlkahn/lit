import { searchContent } from "./ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import type { PaletteProvider, PaletteResult } from "./paletteRegistry";

function stripMarkTags(s: string): string {
  return s.replace(/<\/?mark>/g, "");
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
      data: { path: r.id },
    }));
  },

  onSelect(result: PaletteResult): void {
    const data = result.data as { path: string };
    const { currentPagePath, selectPageAtLine } = useWorkspaceStore.getState();
    const targetLine = 1;

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
