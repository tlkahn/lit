import type { FlatRow } from "../hooks/useFlatTree";

/** Page relative_paths in visible row order (folders skipped). */
export function visiblePagePaths(rows: FlatRow[]): string[] {
  const paths: string[] = [];
  for (const row of rows) {
    if (row.type === "page") paths.push(row.page.relative_path);
  }
  return paths;
}

/**
 * Resolve which page paths a trash action should target.
 * - Selection non-empty -> all selected paths (stable-sorted by `orderPaths`
 *   when given, so focus math follows visible row order).
 * - Else focused page row -> `[path]`.
 * - Else -> `[]`.
 */
export function resolveTrashTargets(
  selectedPaths: Set<string>,
  focusedRow: FlatRow | null | undefined,
  orderPaths?: string[],
): string[] {
  if (selectedPaths.size > 0) {
    const paths = [...selectedPaths];
    if (orderPaths) {
      const rank = new Map(orderPaths.map((p, i) => [p, i]));
      paths.sort((x, y) => (rank.get(x) ?? Infinity) - (rank.get(y) ?? Infinity));
    }
    return paths;
  }
  if (focusedRow?.type === "page") {
    return [focusedRow.page.relative_path];
  }
  return [];
}

/**
 * Compute the pre-delete row index to focus after trashing `deletedPaths`.
 * - Focused row survives -> keep the focus where it is.
 * - Focused row deleted -> nearest surviving row forward, else backward.
 * - Nothing left -> -1.
 */
export function nextFocusIndex(
  rowsBefore: FlatRow[],
  focusedIndex: number,
  deletedPaths: Set<string>,
): number {
  const isDeleted = (row: FlatRow | undefined): boolean => {
    if (!row || row.type === "folder") return false;
    return deletedPaths.has(row.page.relative_path);
  };

  if (!isDeleted(rowsBefore[focusedIndex])) return focusedIndex;

  for (let i = focusedIndex + 1; i < rowsBefore.length; i++) {
    if (!isDeleted(rowsBefore[i])) return i;
  }
  for (let i = focusedIndex - 1; i >= 0; i--) {
    if (!isDeleted(rowsBefore[i])) return i;
  }
  return -1;
}

/**
 * Resolve the row key to focus after trashing `deletedPaths`, using the
 * pre-delete row list. Returns a stable identity (row key) rather than a
 * pre-delete index, because indices shift once earlier rows are removed;
 * callers resolve the key against the post-delete rows via findIndex.
 * - Focused row survives -> that row's key.
 * - Focused row deleted -> nearest surviving row forward, else backward.
 * - Nothing left -> null.
 */
export function nextFocusKey(
  rowsBefore: FlatRow[],
  focusedIndex: number,
  deletedPaths: Set<string>,
): string | null {
  const isDeleted = (row: FlatRow | undefined): boolean => {
    if (!row || row.type === "folder") return false;
    return deletedPaths.has(row.page.relative_path);
  };

  if (!isDeleted(rowsBefore[focusedIndex])) {
    return rowsBefore[focusedIndex]?.key ?? null;
  }

  for (let i = focusedIndex + 1; i < rowsBefore.length; i++) {
    if (!isDeleted(rowsBefore[i])) return rowsBefore[i]!.key;
  }
  for (let i = focusedIndex - 1; i >= 0; i--) {
    if (!isDeleted(rowsBefore[i])) return rowsBefore[i]!.key;
  }
  return null;
}
