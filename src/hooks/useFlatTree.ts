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

export function useFlatTree(root: FolderNode) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggleCollapse = useCallback((folderPath: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) {
        next.delete(folderPath);
      } else {
        next.add(folderPath);
      }
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
        const isCollapsed = collapsed.has(folderPath);
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

      for (const page of node.pages) {
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
  }, [root, collapsed]);

  return { rows, toggleCollapse };
}
