// Page markers are HTML comments of the form `<!-- Page N -->` that the PDF
// importer interleaves into the exported markdown body. They let us correlate a
// position in the markdown text with a page in the source PDF.
//
// Both forward sync (md -> PDF, Phase 3) and reverse sync (PDF -> md, Phase 4)
// consume these markers, so the scanner is kept pure and dependency-free.

import type { Text } from "@codemirror/state";

export interface PageMarker {
  /** The page number declared in the comment (often 1-based as authored). */
  page: number;
  /** The char index in the source text where the `<!--` comment starts. */
  charOffset: number;
}

/** Matches `<!-- Page N -->` with optional trailing metadata (e.g. `<!-- Page 3 - 2 images 1 videos -->`). */
export const PAGE_MARKER_REGEX_SOURCE = "<!--\\s*Page\\s+(\\d+)\\b.*?-->";

/**
 * Scan `text` for page markers, returning them in document (offset) order.
 */
export function parsePageMarkers(text: string): PageMarker[] {
  const regex = new RegExp(PAGE_MARKER_REGEX_SOURCE, "g");
  const markers: PageMarker[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    markers.push({ page: parseInt(m[1] ?? "", 10), charOffset: m.index });
  }
  return markers;
}

/**
 * Given markers in document order and a char offset, return the 0-based PDF
 * page INDEX whose marker most recently precedes (or starts at) the offset.
 *
 * The return value is the array index of the matching marker, NOT `marker.page`.
 * The Nth marker in document order corresponds to PDF page index N-1, which is
 * exactly the array position. PdfViewer.goToPage also expects a 0-based index,
 * so the array index can be passed straight through. (Reverse sync in Phase 4
 * reuses this same marker-index <-> page-index mapping.)
 *
 * Returns 0 when there are no markers or the offset precedes the first marker.
 */
export function pageForOffset(markers: PageMarker[], offset: number): number {
  if (markers.length === 0) return 0;
  let index = 0;
  for (let i = 0; i < markers.length; i++) {
    if (markers[i]!.charOffset <= offset) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Memoized marker cache keyed by CodeMirror Text identity.
//
// CodeMirror's Text is an immutable persistent rope: on edits a NEW Text object
// is created, while cursor-only changes reuse the SAME reference. A single-entry
// cache with strict identity (`===`) therefore avoids re-scanning on every cursor
// move while correctly invalidating on every edit.
//
// NOTE: The returned array must not be mutated by callers — doing so would
// corrupt the cache. All current consumers (pageForOffset, dispatchReverseSync)
// only read the array.
//
// If multi-editor-pair linking is added later, upgrade to WeakMap<Text, PageMarker[]>.
// ---------------------------------------------------------------------------

let cachedDoc: Text | null = null;
let cachedMarkers: PageMarker[] = [];

/**
 * Return page markers for a CodeMirror `Text` object, re-parsing only when the
 * document identity changes (i.e. after an edit). Cursor-only changes are O(1).
 */
export function getCachedPageMarkers(doc: Text): PageMarker[] {
  if (doc === cachedDoc) return cachedMarkers;
  cachedDoc = doc;
  cachedMarkers = parsePageMarkers(doc.toString());
  return cachedMarkers;
}

/** Reset the marker cache. Test-only helper to prevent cross-test leakage. */
export function _resetMarkerCacheForTesting(): void {
  cachedDoc = null;
  cachedMarkers = [];
}
