import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import { getPaneView } from "./editorViewRef";
import { usePanePdfLinkStore } from "../stores/panePdfLink";
import type { PageMarker } from "./pageMarkers";

// Reverse sync (PDF -> md): when the linked PDF pane changes page, scroll the
// linked markdown editor to the matching page marker. This is the exact inverse
// of forwardSync's pageForOffset mapping (see pageMarkers.ts):
//
//   pageForOffset(markers, offset) -> array index N == 0-based PDF page index N
//
// So the inverse is a plain array-index lookup: markers[pageIndex]. We do NOT
// search for marker.page === pageIndex + 1 — authored page numbers can start at
// any value or have gaps, but their document ORDER is what defines the mapping.
//
// The module is kept dependency-light like forwardSync.ts.

/**
 * Scroll the linked editor pane so the marker for `pageIndex` (0-based PDF page
 * index) is at the top. No-op when there is no marker for that index or no
 * editor view registered for `linkedEditorPaneId`.
 */
export function dispatchReverseSync(
  pageIndex: number,
  linkedEditorPaneId: string,
  markers: PageMarker[],
): void {
  if (!usePanePdfLinkStore.getState().syncEnabled) {
    console.log("[sync:rev] BAIL — syncEnabled=false");
    return;
  }

  const marker = markers[pageIndex];
  if (!marker) {
    console.log("[sync:rev] BAIL — no marker for pageIndex=%d (markers.length=%d)", pageIndex, markers.length);
    return;
  }

  const view = getPaneView(linkedEditorPaneId);
  if (!view) {
    console.log("[sync:rev] BAIL — no EditorView for pane %s", linkedEditorPaneId);
    return;
  }

  console.log("[sync:rev] page=%d → charOffset=%d (editor pane %s)", pageIndex, marker.charOffset, linkedEditorPaneId);
  usePanePdfLinkStore.getState().setLastSyncedPage(pageIndex);

  const pos = Math.min(marker.charOffset, view.state.doc.length);
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: "start" }),
  });
}
