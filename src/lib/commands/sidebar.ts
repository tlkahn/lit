import { registerOnce } from "../commandRegistry";
import { useWorkspaceStore } from "../../stores/workspace";

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
          window.dispatchEvent(
            new CustomEvent("lit:reveal-in-file-tree", { detail: { relativePath: path } }),
          );
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
          window.dispatchEvent(
            new CustomEvent("lit:reveal-bib-entry-for-page", { detail: { relativePath: path } }),
          );
        }
      },
    },
  ]);
}
