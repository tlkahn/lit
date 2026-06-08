import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import type { PageMeta } from "../lib/ipc";

export type LeafFileType = "pdf" | "markdown";

/**
 * Derive a leaf's file type from the workspace pages list by matching its
 * `pagePath` against `relative_path`.
 *
 * Returns `null` when `pagePath` is null OR when no page metadata is found
 * (e.g. the pages list has not loaded yet). Callers should treat a `null`
 * result as "not yet known" and fall back to the markdown editor; the leaf
 * re-renders and re-routes once the matching page meta arrives.
 */
export function getFileType(
  pagePath: string | null,
  pages: PageMeta[],
): LeafFileType | null {
  if (pagePath == null) return null;
  return pages.find((p) => p.relative_path === pagePath)?.file_type ?? null;
}

export function useLeafFileType(paneId: string): LeafFileType | null {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const pages = useWorkspaceStore((s) => s.pages);
  return getFileType(pagePath, pages);
}
