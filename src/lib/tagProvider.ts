import { searchTags, listPagesByTag } from "./ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import type { PaletteProvider, PaletteResult } from "./paletteRegistry";

export const tagProvider: PaletteProvider = {
  id: "tags",
  prefix: "#",
  label: "Tags",
  priority: 30,

  async search(query: string): Promise<PaletteResult[]> {
    if (!query) return [];

    if (query.startsWith(":")) {
      const tag = query.slice(1);
      if (!tag) return [];
      const pages = await listPagesByTag(tag);
      return pages.map((p) => ({
        id: p.id,
        title: p.title,
        subtitle: p.first_paragraph || undefined,
        section: "Tags",
        data: { path: p.id },
      }));
    }

    const results = await searchTags(query);
    return results.map((r) => ({
      id: `tag:${r.tag}`,
      title: r.tag,
      subtitle: r.count === 1 ? "1 page" : `${r.count} pages`,
      section: "Tags",
      data: { tag: r.tag },
    }));
  },

  onSelect(result: PaletteResult): void | false {
    const data = result.data as { tag?: string; path?: string };

    if (data.tag) {
      window.dispatchEvent(
        new CustomEvent("lit:palette-set-input", {
          detail: { value: `#:${data.tag}` },
        }),
      );
      return false;
    }

    if (data.path) {
      const { currentPagePath, selectPage } = useWorkspaceStore.getState();

      if (data.path !== currentPagePath) {
        globalJumpTracker.recordJump(
          { notePath: currentPagePath ?? "", line: 1, col: 0 },
          { notePath: data.path, line: 1, col: 0 },
        );
        selectPage(data.path);
      }
    }
  },
};
