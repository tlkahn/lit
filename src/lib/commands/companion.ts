import { registerOnce } from "../commandRegistry";
import { usePaneStore, findLeaf, collectLeaves } from "../../stores/panes";
import type { PaneLeaf } from "../../stores/panes";
import { usePanePdfLinkStore } from "../../stores/panePdfLink";
import { useStatusMessageStore } from "../../stores/statusMessage";
import { findCompanionFile } from "../ipc";
import { getPaneView } from "../editorViewRef";
import { getCachedPageMarkers, pageForOffset } from "../pageMarkers";
import { getPdfCurrentPage } from "../pdfPaneRef";

export type CompanionTarget =
  | { kind: "source-gone" }
  | { kind: "open+vacant"; openId: string; vacantId: string }
  | { kind: "open-only"; openId: string }
  | { kind: "vacant-only"; vacantId: string }
  | { kind: "must-split" };

export function selectCompanionTarget(
  leaves: PaneLeaf[],
  sourceId: string,
  companionPath: string,
): CompanionTarget {
  if (!leaves.some((l) => l.id === sourceId)) return { kind: "source-gone" };

  const others = leaves.filter((l) => l.id !== sourceId);
  const alreadyOpen = others.find((l) => l.pagePath === companionPath);
  const vacant = others.find((l) => l.pagePath == null);

  if (alreadyOpen && vacant) return { kind: "open+vacant", openId: alreadyOpen.id, vacantId: vacant.id };
  if (alreadyOpen) return { kind: "open-only", openId: alreadyOpen.id };
  if (vacant) return { kind: "vacant-only", vacantId: vacant.id };
  return { kind: "must-split" };
}

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
            const selection = selectCompanionTarget(
              collectLeaves(store.root),
              sourceId,
              companion,
            );

            let newId: string | null;
            switch (selection.kind) {
              case "source-gone":
                useStatusMessageStore.getState().show("Source pane was closed", "error");
                return;
              case "open+vacant":
              case "open-only":
                newId = selection.openId;
                break;
              case "vacant-only":
                newId = selection.vacantId;
                break;
              case "must-split":
                newId = store.splitPane(sourceId, "horizontal");
                break;
              default: {
                const _exhaustive: never = selection;
                throw new Error(`unhandled companion target: ${String(_exhaustive)}`);
              }
            }
            if (newId == null) {
              useStatusMessageStore
                .getState()
                .show("Cannot split: maximum panes reached", "error");
              return;
            }
            store.focusPane(newId);
            store.setPanePage(newId, companion);
            const linkStore = usePanePdfLinkStore.getState();
            linkStore.linkPanes(sourceId, newId);

            if (!pagePath.toLowerCase().endsWith(".pdf")) {
              const view = getPaneView(sourceId);
              if (view) {
                const offset = view.state.selection.main.head;
                const markers = getCachedPageMarkers(view.state.doc);
                const pageIndex = pageForOffset(markers, offset);
                linkStore.setPendingPdfSync(newId, pageIndex);
              }
            } else {
              const page = getPdfCurrentPage(sourceId) ?? linkStore.currentPage.get(sourceId) ?? 0;
              linkStore.setPendingEditorSync(newId, page);
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
