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
 * Options that adapt the shared dispatch body for the initial-sync site (when a
 * companion editor is explicitly opened/focused) versus the live PDF -> md
 * reverse-sync site.
 */
export interface ReverseSyncOptions {
  /**
   * Bypass the `syncEnabled` and `view.hasFocus` guards. Used by the
   * companion.open initial-sync path: opening a companion is an explicit user
   * action and the editor pane may already be focused at dispatch time, so
   * neither guard should suppress the scroll.
   */
  skipGuards?: boolean;
  /**
   * Map an out-of-bounds `pageIndex` onto the last marker (when the PDF has more
   * pages than the markdown has `<!-- Page N -->` markers). With empty markers
   * this stays a no-op. Off by default so the live reverse-sync path keeps its
   * strict "no marker -> no-op" behavior.
   */
  clampIndex?: boolean;
}

/**
 * Scroll the linked editor pane so the marker for `pageIndex` (0-based PDF page
 * index) is at the top. No-op when there is no marker for that index or no
 * editor view registered for `linkedEditorPaneId`.
 */
export function dispatchReverseSync(
  pageIndex: number,
  linkedEditorPaneId: string,
  markers: PageMarker[],
  options?: ReverseSyncOptions,
): void {
  const skipGuards = options?.skipGuards ?? false;
  const clampIndex = options?.clampIndex ?? false;

  if (markers.length === 0) return;

  // Resolve the effective marker index. clampIndex maps an out-of-bounds page
  // onto the last marker; without it an out-of-bounds index simply has no
  // marker and falls through to the no-op below.
  const index = clampIndex
    ? Math.min(pageIndex, markers.length - 1)
    : pageIndex;

  const marker = markers[index];
  if (!marker) return;

  if (!skipGuards && !usePanePdfLinkStore.getState().syncEnabled) return;

  const view = getPaneView(linkedEditorPaneId);
  if (!view) return;

  if (!skipGuards && view.hasFocus) return;

  // Record the EFFECTIVE (possibly clamped) index BEFORE dispatch so the
  // forward-sync echo guard compares against a page that has a real marker.
  usePanePdfLinkStore.getState().setLastSyncedPage(index);

  const pos = Math.min(marker.charOffset, view.state.doc.length);
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: "start" }),
  });
}
