import { useCallback, useSyncExternalStore } from "react";

export interface PaneContentEntry {
  title: string;
  frontmatter: Record<string, unknown>;
}

const entries = new Map<string, PaneContentEntry>();
const subscribers = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const cb of subscribers) cb();
}

export function registerPaneContent(
  paneId: string,
  entry: PaneContentEntry,
): void {
  entries.set(paneId, { ...entry });
  notify();
}

export function unregisterPaneContent(paneId: string): void {
  entries.delete(paneId);
  notify();
}

export function getPaneContent(paneId: string): PaneContentEntry | null {
  return entries.get(paneId) ?? null;
}

export function updatePaneContent(
  paneId: string,
  partial: Partial<PaneContentEntry>,
): boolean {
  const existing = entries.get(paneId);
  if (!existing) return false;
  entries.set(paneId, {
    ...existing,
    ...partial,
    frontmatter: partial.frontmatter
      ? { ...existing.frontmatter, ...partial.frontmatter }
      : existing.frontmatter,
  });
  notify();
  return true;
}

export function subscribe(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getSnapshot(): number {
  return version;
}

export function usePaneContent(paneId: string): PaneContentEntry | null {
  const snap = useCallback(() => getPaneContent(paneId), [paneId]);
  return useSyncExternalStore(subscribe, snap);
}

export function _resetForTesting(): void {
  entries.clear();
  subscribers.clear();
  version = 0;
}
