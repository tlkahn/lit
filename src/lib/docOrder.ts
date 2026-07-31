import type { CardboxAnnotation } from "./ipc";

/**
 * Document-position comparator for cardbox annotations (#968).
 *
 * Mirrors the backend's stable listing order (`ORDER BY a.node_id,
 * a.char_start` in src-tauri/src/graph/store.rs), so page ids compare as
 * plain byte-wise strings (`<`/`>`), NOT locale-aware collation. The uuid
 * tiebreak keeps the sort total and deterministic.
 */
export function compareDocPosition(a: CardboxAnnotation, b: CardboxAnnotation): number {
  if (a.source_page_id < b.source_page_id) return -1;
  if (a.source_page_id > b.source_page_id) return 1;
  if (a.char_start !== b.char_start) return a.char_start - b.char_start;
  if (a.uuid < b.uuid) return -1;
  if (a.uuid > b.uuid) return 1;
  return 0;
}

/** Returns a new array sorted by document position; the input is untouched. */
export function sortByDocPosition(anns: CardboxAnnotation[]): CardboxAnnotation[] {
  return [...anns].sort(compareDocPosition);
}
