import type { PaneNode } from "../stores/panes";
import { findLeaf, collectLeaves } from "../stores/panes";
import type { ViewState } from "../types";

export const LAYOUT_KEY_PREFIX = "lit-pane-layout-";
export const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

export interface StoredLayout {
  root: PaneNode;
  focusedPaneId: string;
  paneViewStates: Record<string, ViewState>;
  /** Undirected editor<->PDF link pairs, each pair stored once. */
  pdfLinks: [string, string][];
  savedAt: number;
}

export function layoutStorageKey(workspacePath: string): string {
  return `${LAYOUT_KEY_PREFIX}${workspacePath}`;
}

export function serializeLayout(
  root: PaneNode,
  focusedPaneId: string,
  paneViewStates: Record<string, ViewState>,
  pdfLinks: [string, string][] = [],
): string {
  const stored: StoredLayout = {
    root,
    focusedPaneId,
    paneViewStates,
    pdfLinks,
    savedAt: Date.now(),
  };
  return JSON.stringify(stored);
}

export function deserializeLayout(raw: string | null): StoredLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.root || typeof parsed.root.type !== "string") return null;
    if (typeof parsed.focusedPaneId !== "string") return null;
    return {
      root: parsed.root,
      focusedPaneId: parsed.focusedPaneId,
      paneViewStates: parsed.paneViewStates ?? {},
      pdfLinks: parsed.pdfLinks ?? [],
      savedAt: parsed.savedAt ?? 0,
    };
  } catch {
    return null;
  }
}

export function validateLayout(root: PaneNode, existingPaths: Set<string>): PaneNode {
  if (root.type === "leaf") {
    if (root.pagePath === null) return root;
    if (existingPaths.has(root.pagePath)) return root;
    return { ...root, pagePath: null };
  }
  let changed = false;
  const newChildren = root.children.map((child) => {
    const result = validateLayout(child, existingPaths);
    if (result !== child) changed = true;
    return result;
  });
  if (!changed) return root;
  return { ...root, children: newChildren };
}

export function validateFocusedPaneId(root: PaneNode, focusedPaneId: string): string {
  if (findLeaf(root, focusedPaneId)) return focusedPaneId;
  return collectLeaves(root)[0]!.id;
}

export function pruneViewStates(
  paneViewStates: Record<string, ViewState>,
  root: PaneNode,
): Record<string, ViewState> {
  const validIds = new Set(collectLeaves(root).map((l) => l.id));
  const result: Record<string, ViewState> = {};
  for (const [id, vs] of Object.entries(paneViewStates)) {
    if (validIds.has(id)) result[id] = vs;
  }
  return result;
}

export function saveLayout(
  workspacePath: string,
  root: PaneNode,
  focusedPaneId: string,
  paneViewStates: Record<string, ViewState>,
  pdfLinks: [string, string][] = [],
): void {
  localStorage.setItem(
    layoutStorageKey(workspacePath),
    serializeLayout(root, focusedPaneId, paneViewStates, pdfLinks),
  );
}

export function loadLayout(workspacePath: string): StoredLayout | null {
  return deserializeLayout(localStorage.getItem(layoutStorageKey(workspacePath)));
}

export function cleanupStaleLayouts(now?: number): void {
  const threshold = (now ?? Date.now()) - STALE_THRESHOLD_MS;
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(LAYOUT_KEY_PREFIX)) continue;
    const raw = localStorage.getItem(key);
    const stored = deserializeLayout(raw);
    if (!stored || stored.savedAt < threshold) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}
