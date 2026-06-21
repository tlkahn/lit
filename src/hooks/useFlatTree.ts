import { useState, useMemo, useCallback } from "react";
import type { PageMeta } from "../lib/ipc";

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

export function useFlatTree(
  root: FolderNode,
  pageComparator?: (a: PageMeta, b: PageMeta) => number,
) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleCollapse = useCallback((folderPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
      return next;
    });
  }, []);

  const expandPaths = useCallback((paths: string[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of paths) next.add(p);
      return next;
    });
  }, []);

  const rows = useMemo(() => {
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
  }, [root, expanded, pageComparator]);

  return { rows, toggleCollapse, expandPaths };
}
