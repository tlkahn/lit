import { useState, useMemo, useCallback, useRef } from "react";
import type { PageMeta } from "../lib/ipc";
import { getAncestorPaths } from "../lib/pathUtils";

export interface FolderNode {
  name: string;
  pages: PageMeta[];
  children: Map<string, FolderNode>;
}

export type FlatRow =
  | {
      type: "folder";
      key: string;
      depth: number;
      folderName: string;
      folderPath: string;
      isCollapsed: boolean;
    }
  | {
      type: "page";
      key: string;
      depth: number;
      page: PageMeta;
    };

/** Pure function that walks the tree and produces a flat row list. */
export function buildRows(
  root: FolderNode,
  expanded: Set<string>,
  pageComparator?: (a: PageMeta, b: PageMeta) => number,
): FlatRow[] {
  const result: FlatRow[] = [];

  function walk(node: FolderNode, depth: number, pathPrefix: string) {
    const childDepth = depth + (node.name ? 1 : 0);
    const folderPath = node.name
      ? pathPrefix
        ? `${pathPrefix}/${node.name}`
        : node.name
      : pathPrefix;

    if (node.name) {
      const isCollapsed = !expanded.has(folderPath);
      result.push({
        type: "folder",
        key: `folder:${folderPath}`,
        depth,
        folderName: node.name,
        folderPath,
        isCollapsed,
      });
      if (isCollapsed) return;
    }

    const sortedDirs = [...node.children.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    );

    for (const [, child] of sortedDirs) {
      walk(child, childDepth, folderPath);
    }

    const sortedPages = pageComparator
      ? [...node.pages].sort(pageComparator)
      : node.pages;
    for (const page of sortedPages) {
      result.push({
        type: "page",
        key: page.relative_path,
        depth: childDepth,
        page,
      });
    }
  }

  walk(root, 0, "");
  return result;
}

export function useFlatTree(
  root: FolderNode,
  pageComparator?: (a: PageMeta, b: PageMeta) => number,
) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // Mirror of the latest expanded state for synchronous reads.
  // React's functional updater receives `prev` but may be deferred,
  // so we maintain a ref that is always updated inside the updater.
  const expandedRef = useRef(expanded);

  const toggleCollapse = useCallback((folderPath: string) => {
    const next = new Set(expandedRef.current);
    if (next.has(folderPath)) {
      next.delete(folderPath);
    } else {
      next.add(folderPath);
    }
    expandedRef.current = next;
    setExpanded(next);
  }, []);

  const expandPaths = useCallback((paths: string[]) => {
    const next = new Set(expandedRef.current);
    for (const p of paths) next.add(p);
    expandedRef.current = next;
    setExpanded(next);
  }, []);

  const rows = useMemo(
    () => buildRows(root, expanded, pageComparator),
    [root, expanded, pageComparator],
  );

  const revealPath = useCallback(
    (relativePath: string): number => {
      // Normalize the path once: strip leading/trailing/consecutive slashes
      // so that e.g. "/docs/readme.md" matches the tree's "docs/readme.md".
      const normalized = relativePath
        .split("/")
        .filter((seg) => seg !== "")
        .join("/");

      // Compute ancestor folder paths using the normalized path
      const ancestorPaths = getAncestorPaths(normalized);

      // Build nextExpanded from the ref (which always holds the latest
      // expanded set, even when a prior setExpanded updater has been
      // deferred by React's batching). This avoids the race where a
      // prior toggleCollapse enqueued a state update that React hasn't
      // committed yet -- the ref was already updated synchronously
      // inside that updater.
      const nextExpanded = new Set(expandedRef.current);
      for (const p of ancestorPaths) nextExpanded.add(p);

      const nextRows = buildRows(root, nextExpanded, pageComparator);
      const idx = nextRows.findIndex(
        (r) => r.type === "page" && r.page.relative_path === normalized,
      );

      // Update React state so the UI re-renders with expanded ancestors.
      expandedRef.current = nextExpanded;
      setExpanded(nextExpanded);

      return idx;
    },
    [root, pageComparator],
  );

  return { rows, toggleCollapse, expandPaths, revealPath };
}
