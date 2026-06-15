import { create } from "zustand";
import type { CardboxAnnotation, GroupInfo } from "../lib/ipc";
import {
  listAllAnnotations,
  readCardboxLayout,
  writeCardboxLayout,
  addCardboxLink,
  removeCardboxLink,
} from "../lib/ipc";

export interface CardboxStore {
  annotations: CardboxAnnotation[];
  expandedUuid: string | null;
  loading: boolean;
  searchQuery: string;
  activeTypes: Set<string> | null;
  order: string[];
  links: [string, string][];
  groups: Record<string, GroupInfo>;
  fetchAnnotations: () => Promise<void>;
  toggleExpand: (uuid: string) => void;
  collapseAll: () => void;
  setSearchQuery: (query: string) => void;
  toggleType: (type: string) => void;
  resetFilters: () => void;
  setOrder: (order: string[]) => void;
  loadLayout: () => Promise<void>;
  saveLayout: () => Promise<void>;
  addLink: (a: string, b: string) => Promise<void>;
  removeLink: (a: string, b: string) => Promise<void>;
}

export const useCardboxStore = create<CardboxStore>((set, get) => ({
  annotations: [],
  expandedUuid: null,
  loading: false,
  searchQuery: "",
  activeTypes: null,
  order: [],
  links: [],
  groups: {},
  fetchAnnotations: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const annotations = await listAllAnnotations();
      const types = new Set(annotations.map((a) => a.annotation_type));
      set((s) => {
        const newUuids = new Set(annotations.map((a) => a.uuid));
        const prunedLinks = s.links.filter(
          ([x, y]) => newUuids.has(x) && newUuids.has(y),
        );
        // Prune group members against the new UUID set; drop empty groups
        const prunedGroups: Record<string, GroupInfo> = {};
        for (const [gid, info] of Object.entries(s.groups)) {
          const kept = info.order.filter((id) => newUuids.has(id));
          if (kept.length > 0) {
            prunedGroups[gid] = { ...info, order: kept };
          }
        }
        // Collect all known group IDs so we can preserve them in order
        const groupIdSet = new Set(Object.keys(prunedGroups));
        return {
          annotations,
          loading: false,
          activeTypes: s.activeTypes === null ? types : s.activeTypes,
          links: prunedLinks,
          groups: prunedGroups,
          order: (() => {
            if (s.order.length === 0) return annotations.map((a) => a.uuid);
            // Keep entries that are either annotation UUIDs or group: refs
            const kept = s.order.filter(
              (id) =>
                newUuids.has(id) ||
                (id.startsWith("group:") && groupIdSet.has(id.slice(6))),
            );
            const keptSet = new Set(kept);
            const added = annotations
              .filter((a) => !keptSet.has(a.uuid))
              .map((a) => a.uuid);
            return [...kept, ...added];
          })(),
        };
      });
    } catch {
      set({ loading: false });
    }
  },
  toggleExpand: (uuid) =>
    set((s) => ({
      expandedUuid: s.expandedUuid === uuid ? null : uuid,
    })),
  collapseAll: () => set({ expandedUuid: null }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  toggleType: (type) =>
    set((s) => {
      const next = new Set(s.activeTypes);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return { activeTypes: next };
    }),
  resetFilters: () =>
    set((s) => ({
      searchQuery: "",
      activeTypes: new Set(s.annotations.map((a) => a.annotation_type)),
    })),
  setOrder: (order) => set({ order }),
  loadLayout: async () => {
    try {
      const layout = await readCardboxLayout();
      const groups = layout.groups ?? {};
      if (layout.order.length > 0) {
        set({ order: layout.order, links: layout.links ?? [], groups });
      } else {
        set({ links: layout.links ?? [], groups });
      }
    } catch {
      // Ignore — use default order from annotations
    }
  },
  saveLayout: async () => {
    const { order, links, groups } = get();
    const hasGroups = Object.keys(groups).length > 0;
    try {
      await writeCardboxLayout({
        version: hasGroups ? 3 : 2,
        order,
        links,
        groups,
      });
    } catch {
      // Ignore write failures silently
    }
  },
  addLink: async (a, b) => {
    if (a === b) return;
    const norm: [string, string] = a <= b ? [a, b] : [b, a];
    set((s) => {
      if (s.links.some(([x, y]) => x === norm[0] && y === norm[1])) return s;
      return { links: [...s.links, norm] };
    });
    await addCardboxLink(a, b);
  },
  removeLink: async (a, b) => {
    const norm: [string, string] = a <= b ? [a, b] : [b, a];
    set((s) => ({
      links: s.links.filter(([x, y]) => !(x === norm[0] && y === norm[1])),
    }));
    await removeCardboxLink(a, b);
  },
}));
