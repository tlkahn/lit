import { searchPagesByTitle } from "./ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { globalJumpTracker } from "../editor/jumpTracker";
import type { PaletteProvider, PaletteResult } from "./paletteRegistry";

const FILE_ICONS: Record<string, string> = {
  md: "",
  pdf: "",
};
const DEFAULT_ICON = "";

function fileIcon(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return FILE_ICONS[ext] ?? DEFAULT_ICON;
}

export { fileIcon as _fileIcon };

export const fileProvider: PaletteProvider = {
  id: "files",
  prefix: "$",
  label: "Files",
  priority: 10,

  async search(query: string): Promise<PaletteResult[]> {
    if (!query) return [];
    const results = await searchPagesByTitle(query);
    return results.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.excerpt || undefined,
      icon: fileIcon(r.id),
      section: "Files",
      data: { path: r.id },
    }));
  },

  onSelect(result: PaletteResult): void {
    const data = result.data as { path: string };
    const { currentPagePath, selectPage } = useWorkspaceStore.getState();

    if (data.path === currentPagePath) return;

    globalJumpTracker.recordJump(
      { notePath: currentPagePath ?? "", line: 1, col: 0 },
      { notePath: data.path, line: 1, col: 0 },
    );

    selectPage(data.path);
  },
};
