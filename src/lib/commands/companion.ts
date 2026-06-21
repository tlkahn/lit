import { registerOnce } from "../commandRegistry";
import { usePaneStore, findLeaf, collectLeaves } from "../../stores/panes";
import { usePanePdfLinkStore } from "../../stores/panePdfLink";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { findCompanionFile } from "../ipc";
import { getPaneView } from "../editorViewRef";
import { getCachedPageMarkers, pageForOffset } from "../pageMarkers";
import { getPdfCurrentPage } from "../pdfPaneRef";

export function initCompanionCommands(): void {
  registerOnce("companion", [
    {
      id: "companion.open",
      label: "Open Companion File",
      keywords: ["pdf", "markdown", "companion", "sibling"],
      shortcut: "Mod-Shift-o",
      icon: "🔗",
      when: () => {
        const s = usePaneStore.getState();
        return findLeaf(s.root, s.focusedPaneId)?.pagePath != null;
      },
      action: () => {
        const pane = usePaneStore.getState();
        // Capture the source pane id BEFORE splitting, since splitPane
        // mutates focusedPaneId to point at the newly created leaf.
        const sourceId = pane.focusedPaneId;
        const pagePath = findLeaf(pane.root, sourceId)?.pagePath;
        if (pagePath == null) return;

        findCompanionFile(pagePath)
          .then((companion) => {
            if (companion == null) {
              useStatusMessageStore
                .getState()
                .show("No companion file found", "error");
              return;
            }
            const store = usePaneStore.getState();
            const leaves = collectLeaves(store.root);
            const vacant = leaves.find(
              (l) => l.pagePath == null && l.id !== sourceId,
            );
            let targetId: string | null;
            if (vacant) {
              targetId = vacant.id;
            } else if (leaves.length > 1) {
              const idx = leaves.findIndex((l) => l.id === sourceId);
              targetId = leaves[(idx + 1) % leaves.length]!.id;
            } else {
              targetId = store.splitPane(sourceId, "horizontal");
            }
            if (targetId == null) {
              useStatusMessageStore
                .getState()
                .show("Cannot split: maximum panes reached or source pane closed", "error");
              return;
            }
            store.focusPane(targetId);
            store.setPanePage(targetId, companion);
            const linkStore = usePanePdfLinkStore.getState();
            linkStore.linkPanes(sourceId, targetId);

            if (!pagePath.toLowerCase().endsWith(".pdf")) {
              const view = getPaneView(sourceId);
              if (view) {
                const offset = view.state.selection.main.head;
                const markers = getCachedPageMarkers(view.state.doc);
                const pageIndex = pageForOffset(markers, offset);
                linkStore.setPendingPdfSync(targetId, pageIndex);
              }
            } else {
              const page = getPdfCurrentPage(sourceId) ?? linkStore.currentPage.get(sourceId) ?? 0;
              linkStore.setPendingEditorSync(targetId, page);
            }

            useStatusMessageStore
              .getState()
              .show(`Linked ${pagePath} ↔ ${companion}`, "success");
          })
          .catch((err) => {
            useStatusMessageStore.getState().show(String(err), "error");
          });
      },
    },
    {
      id: "companion.toggleSync",
      label: "Toggle PDF Sync",
      keywords: ["sync", "pdf", "link", "companion"],
      icon: "🔗",
      shortcut: "Mod-Shift-y",
      action: () => {
        usePanePdfLinkStore.getState().toggleSync();
        const enabled = usePanePdfLinkStore.getState().syncEnabled;
        useStatusMessageStore
          .getState()
          .show(enabled ? "Sync enabled" : "Sync disabled", "success");
      },
    },
  ]);
}
