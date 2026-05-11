import type { PageMeta } from "./ipc";

export type SortKey = "title" | "modified_at" | "created_at";
export type SortDirection = "asc" | "desc";
export interface SortConfig {
  key: SortKey;
  direction: SortDirection;
}

export function makePageComparator(
  config: SortConfig,
): (a: PageMeta, b: PageMeta) => number {
  const { key, direction } = config;

  if (key === "title") {
    const mul = direction === "asc" ? 1 : -1;
    return (a, b) => mul * a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  }

  const mul = direction === "asc" ? 1 : -1;
  return (a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av == null && bv == null) return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av === bv) return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    return mul * (av - bv);
  };
}

export function toggleDirection(d: SortDirection): SortDirection {
  return d === "asc" ? "desc" : "asc";
}

export function defaultDirectionFor(key: SortKey): SortDirection {
  return key === "title" ? "asc" : "desc";
}
