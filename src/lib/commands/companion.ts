import { registerOnce } from "../commandRegistry";
import { usePaneStore, findLeaf, collectLeaves } from "../../stores/panes";
import { usePanePdfLinkStore } from "../../stores/panePdfLink";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { findCompanionFile } from "../ipc";

export function initCompanionCommands(): void {
  registerOnce("companion", [
    {
      id: "companion.open",
      label: "Open Companion File",
      keywords: ["pdf", "markdown", "companion", "sibling"],
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
            const vacant = collectLeaves(store.root).find(
              (l) => l.pagePath == null && l.id !== sourceId,
            );
            const newId = vacant?.id ?? store.splitPane(sourceId, "horizontal");
            if (newId == null) {
              useStatusMessageStore
                .getState()
                .show("Cannot split: maximum panes reached or source pane closed", "error");
              return;
            }
            store.focusPane(newId);
            store.setPanePage(newId, companion);
            usePanePdfLinkStore.getState().linkPanes(sourceId, newId);
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
