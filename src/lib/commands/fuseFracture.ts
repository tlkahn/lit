import { registerOnce } from "../commandRegistry";
import { useGraphSelectionStore } from "../../stores/graphSelection";
import { useWorkspaceStore } from "../../stores/workspace";
import { readPage, previewSplit } from "../ipc";

export function initFuseFractureCommands(): void {
  registerOnce("fuse-fracture", [
    {
      id: "lit.mergeDocuments",
      label: "Merge selected documents",
      keywords: ["fuse", "combine", "join", "merge"],
      when: () => useGraphSelectionStore.getState().selectedNodes.length >= 2,
      action: () => {
        const nodes = useGraphSelectionStore.getState().selectedNodes;
        Promise.all(nodes.map((path) => readPage(path))).then((docs) => {
          window.dispatchEvent(
            new CustomEvent("lit:open-merge-preview", { detail: { docs } }),
          );
        });
      },
    },
    {
      id: "lit.splitDocument",
      label: "Split current document",
      keywords: ["fracture", "break", "divide", "split"],
      when: () => useWorkspaceStore.getState().currentPagePath != null,
      action: () => {
        const path = useWorkspaceStore.getState().currentPagePath!;
        readPage(path).then((page) =>
          previewSplit(page.body, page.meta.title, page.meta.frontmatter).then((plan) => {
            window.dispatchEvent(
              new CustomEvent("lit:open-split-preview", {
                detail: { plan, originalPath: path },
              }),
            );
          }),
        );
      },
    },
  ]);
}
