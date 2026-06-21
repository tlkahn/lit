import { registerOnce } from "../commandRegistry";
import { useWorkspaceStore } from "../../stores/workspace";
import { dispatchRevealInFileTree, dispatchRevealBibEntryForPage } from "../sidebarEvents";

function hasPage(): boolean {
  return (
    useWorkspaceStore.getState().workspacePath !== null &&
    useWorkspaceStore.getState().currentPagePath !== null
  );
}

export function initSidebarCommands(): void {
  registerOnce("sidebar", [
    {
      id: "sidebar.revealInFileTree",
      label: "Reveal Active File in File Tree",
      keywords: ["reveal", "sidebar", "file", "tree", "locate", "scroll"],
      icon: "📂",
      when: hasPage,
      action: () => {
        const path = useWorkspaceStore.getState().currentPagePath;
        if (path) {
          dispatchRevealInFileTree(path);
        }
      },
    },
    {
      id: "sidebar.revealInLibrary",
      label: "Reveal Active File in Reference Library",
      keywords: ["reveal", "sidebar", "reference", "library", "bib", "citation"],
      icon: "📚",
      when: hasPage,
      action: () => {
        const path = useWorkspaceStore.getState().currentPagePath;
        if (path) {
          dispatchRevealBibEntryForPage(path);
        }
      },
    },
  ]);
}
