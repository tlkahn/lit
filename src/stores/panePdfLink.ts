import { create } from "zustand";
import { usePaneStore, collectLeaves, type PaneNode } from "./panes";

export interface PanePdfLinkStore {
  links: Map<string, string>;
  linkPanes(a: string, b: string): void;
  unlinkPane(id: string): void;
  getLinkedPane(id: string): string | undefined;
  /**
   * The most recent page a reverse sync (PDF -> md) scrolled the editor to, plus
   * the wall-clock time it happened. Forward sync consults this to suppress the
   * echo selection change that reverse sync triggers. Null when no reverse sync
   * has fired (or after a reset).
   */
  lastSyncedPage: { page: number; at: number } | null;
  /** Record `page` as the most recent reverse-sync target at `at` (defaults to now). */
  setLastSyncedPage(page: number, at?: number): void;
  /**
   * Global on/off for bidirectional page sync. Single global flag (not per-pair)
   * because the product links one editor<->PDF pair at a time — consistent with
   * the module-singleton forwardSync timer. Forward sync checks this at FIRE time;
   * reverse sync checks it at the top of dispatch.
   */
  syncEnabled: boolean;
  /** Flip syncEnabled. */
  toggleSync(): void;
  /** Set syncEnabled explicitly (used when restoring persisted state). */
  setSyncEnabled(v: boolean): void;
  /**
   * Best-effort, non-persisted map of paneId -> 0-based current page for live PDF
   * panes. Updated from PdfViewerPane.onPageChange; consumed by the status-bar
   * linked indicator to show "Page N".
   */
  currentPage: Map<string, number>;
  /** Record `pageIndex` (0-based) as the current page for `paneId`. */
  setCurrentPage(paneId: string, pageIndex: number): void;
}

export const usePanePdfLinkStore = create<PanePdfLinkStore>((set, get) => ({
  links: new Map(),
  lastSyncedPage: null,
  syncEnabled: true,

  setLastSyncedPage: (page, at = Date.now()) => {
    set({ lastSyncedPage: { page, at } });
  },

  toggleSync: () => set({ syncEnabled: !get().syncEnabled }),
  setSyncEnabled: (v) => set({ syncEnabled: v }),

  currentPage: new Map(),
  setCurrentPage: (paneId, pageIndex) => {
    const currentPage = new Map(get().currentPage);
    currentPage.set(paneId, pageIndex);
    set({ currentPage });
  },

  linkPanes: (a, b) => {
    const links = new Map(get().links);
    // Clear any existing partners of a and b so no dangling one-way links remain.
    const oldA = links.get(a);
    if (oldA && oldA !== b) links.delete(oldA);
    const oldB = links.get(b);
    if (oldB && oldB !== a) links.delete(oldB);
    links.set(a, b);
    links.set(b, a);
    set({ links });
  },

  unlinkPane: (id) => {
    const links = new Map(get().links);
    const partner = links.get(id);
    links.delete(id);
    if (partner) links.delete(partner);
    set({ links });
  },

  getLinkedPane: (id) => get().links.get(id),
}));

// ---------------------------------------------------------------------------
// Serialization helpers for persistence (see paneLayout.ts / workspace.ts).
// The store holds a bidirectional Map (a->b AND b->a); persistence stores each
// undirected pair once.
// ---------------------------------------------------------------------------

/** Convert the bidirectional link Map to a list of undirected pairs (each once). */
export function serializeLinks(links: Map<string, string>): [string, string][] {
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const [a, b] of links) {
    if (seen.has(a) || seen.has(b)) continue;
    seen.add(a);
    seen.add(b);
    pairs.push([a, b]);
  }
  return pairs;
}

/** Build a bidirectional link Map from a list of undirected pairs. */
export function deserializeLinks(pairs: [string, string][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const [a, b] of pairs) {
    map.set(a, b);
    map.set(b, a);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Auto-cleanup: when a linked pane is removed from the pane tree, drop its link
// ---------------------------------------------------------------------------

let cleanupUnsub: (() => void) | null = null;
// Last pane-tree root we processed. The subscription fires on EVERY pane-store
// change (including focus-only updates), but only structural mutations mint a
// new root object — so we skip the tree walk when root identity is unchanged.
let prevRoot: PaneNode | null = null;

export function initPanePdfLinkCleanup(): void {
  if (cleanupUnsub) return;
  prevRoot = usePaneStore.getState().root;
  cleanupUnsub = usePaneStore.subscribe((state) => {
    if (state.root === prevRoot) return;
    prevRoot = state.root;
    const live = new Set(collectLeaves(state.root).map((l) => l.id));
    const { links, unlinkPane, currentPage } = usePanePdfLinkStore.getState();
    for (const [key, value] of links) {
      if (!live.has(key) || !live.has(value)) {
        unlinkPane(key);
      }
    }
    // Drop current-page entries for panes that no longer exist.
    let changed = false;
    const nextCurrentPage = new Map(currentPage);
    for (const id of nextCurrentPage.keys()) {
      if (!live.has(id)) {
        nextCurrentPage.delete(id);
        changed = true;
      }
    }
    if (changed) usePanePdfLinkStore.setState({ currentPage: nextCurrentPage });
  });
}

export function stopPanePdfLinkCleanup(): void {
  cleanupUnsub?.();
  cleanupUnsub = null;
  prevRoot = null;
}
