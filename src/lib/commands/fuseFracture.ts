import { registerOnce } from "../commandRegistry";
import { useGraphSelectionStore } from "../../stores/graphSelection";
import { useWorkspaceStore } from "../../stores/workspace";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { readPage, previewSplit, undoLastOperation, rebuildGraphIndex } from "../ipc";

export function initFuseFractureCommands(): void {
  registerOnce("fuse-fracture", [
    {
      id: "lit.mergeDocuments",
      label: "Merge selected documents",
      keywords: ["fuse", "combine", "join", "merge"],
      icon: "🔀",
      when: () => useGraphSelectionStore.getState().selectedNodes.length >= 2,
      action: () => {
        const nodes = useGraphSelectionStore.getState().selectedNodes;
        if (nodes.length < 2) return;
        Promise.all(nodes.map((path) => readPage(path))).then((docs) => {
          window.dispatchEvent(
            new CustomEvent("lit:open-merge-preview", { detail: { docs } }),
          );
        }).catch(console.error);
      },
    },
    {
      id: "lit.splitDocument",
      label: "Split current document",
      keywords: ["fracture", "break", "divide", "split"],
      icon: "✂️",
      when: () =>
        useWorkspaceStore.getState().workspacePath != null &&
        useWorkspaceStore.getState().currentPagePath != null,
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
        ).catch(console.error);
      },
    },
    {
      id: "lit.undoOperation",
      label: "Undo last merge/split",
      keywords: ["undo", "revert", "rollback"],
      icon: "↩️",
      when: () => useWorkspaceStore.getState().workspacePath != null,
      action: () => {
        useWorkspaceStore.setState({ graphReady: false });
        undoLastOperation()
          .then((description) => {
            useStatusMessageStore.getState().show(`Undid: ${description}`);
            return rebuildGraphIndex();
          })
          .then(() => {
            useWorkspaceStore.setState({ graphReady: true });
            useWorkspaceStore.getState().refreshPages();
            useWorkspaceStore.getState().triggerReload();
          })
          .catch((err) => {
            useWorkspaceStore.setState({ graphReady: true });
            useStatusMessageStore.getState().show(String(err), "error");
          });
      },
    },
  ]);
}
