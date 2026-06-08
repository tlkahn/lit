import { usePaneStore, findLeaf } from "../stores/panes";
import { useWorkspaceStore } from "../stores/workspace";
import type { PageMeta } from "../lib/ipc";

export type LeafFileType = "pdf" | "markdown";

/**
 * Derive a leaf's file type from the workspace pages list by matching its
 * `pagePath` against `relative_path`.
 *
 * Returns `null` only when `pagePath` is null (an empty pane). When the pages
 * list has not loaded yet (no matching meta), falls back to sniffing the
 * extension: a `.pdf` path resolves to `"pdf"` so the leaf routes straight to
 * the PDF viewer instead of flashing the markdown editor (which would run
 * `readPage` on a binary file); everything else resolves to `"markdown"`, the
 * documented fallback. Once the real meta arrives the leaf re-renders with the
 * authoritative type.
 */
export function getFileType(
  pagePath: string | null,
  pages: PageMeta[],
): LeafFileType | null {
  if (pagePath == null) return null;
  const known = pages.find((p) => p.relative_path === pagePath)?.file_type;
  if (known != null) return known;
  return pagePath.toLowerCase().endsWith(".pdf") ? "pdf" : "markdown";
}

export function useLeafFileType(paneId: string): LeafFileType | null {
  const pagePath = usePaneStore((s) => findLeaf(s.root, paneId)?.pagePath ?? null);
  const pages = useWorkspaceStore((s) => s.pages);
  return getFileType(pagePath, pages);
}
