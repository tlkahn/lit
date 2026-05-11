import { useState, useEffect, useCallback, useMemo } from "react";
import {
  makePageComparator,
  toggleDirection,
  defaultDirectionFor,
  type SortKey,
  type SortConfig,
} from "../lib/pageSort";

const DEFAULT_CONFIG: SortConfig = { key: "title", direction: "asc" };
const VALID_KEYS: Set<string> = new Set(["title", "modified_at", "created_at"]);
const VALID_DIRS: Set<string> = new Set(["asc", "desc"]);

function getInitialConfig(storageKey: string): SortConfig {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      VALID_KEYS.has(parsed.key) &&
      VALID_DIRS.has(parsed.direction)
    ) {
      return parsed as SortConfig;
    }
    return DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function useSidebarSort(workspacePath: string) {
  const storageKey = `lit-sidebar-sort:${workspacePath}`;
  const [sortConfig, setSortConfigState] = useState<SortConfig>(() =>
    getInitialConfig(storageKey),
  );

  useEffect(() => {
    setSortConfigState(getInitialConfig(storageKey));
  }, [storageKey]);

  const selectSortKey = useCallback(
    (key: SortKey) => {
      setSortConfigState((prev) => {
        const next: SortConfig =
          prev.key === key
            ? { key, direction: toggleDirection(prev.direction) }
            : { key, direction: defaultDirectionFor(key) };
        localStorage.setItem(storageKey, JSON.stringify(next));
        return next;
      });
    },
    [storageKey],
  );

  const comparator = useMemo(() => makePageComparator(sortConfig), [sortConfig]);

  return { sortConfig, selectSortKey, comparator } as const;
}
