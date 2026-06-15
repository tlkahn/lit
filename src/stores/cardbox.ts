import { create } from "zustand";
import type { CardboxAnnotation, GroupInfo } from "../lib/ipc";
import {
  listAllAnnotations,
  readCardboxLayout,
  writeCardboxLayout,
  addCardboxLink,
  removeCardboxLink,
  createCardboxGroup,
  renameCardboxGroup,
  dissolveCardboxGroup,
  moveCardToGroup as moveCardToGroupIpc,
  removeCardFromGroup as removeCardFromGroupIpc,
  toggleGroupCollapsed,
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
  createGroup: (groupId: string, name: string, cardUuids: string[], afterEntry?: string) => Promise<void>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  dissolveGroup: (groupId: string) => Promise<void>;
  moveCardToGroup: (cardUuid: string, targetGroupId: string, index?: number) => Promise<void>;
  removeCardFromGroup: (cardUuid: string, groupId: string, topLevelIndex?: number) => Promise<void>;
  toggleGroupCollapse: (groupId: string) => Promise<void>;
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
  createGroup: async (groupId, name, cardUuids, afterEntry) => {
    set((s) => {
      const cardSet = new Set(cardUuids);
      // Find afterEntry position BEFORE removal
      const groupEntry = `group:${groupId}`;
      let insertIdx: number | null = null;
      if (afterEntry) {
        const pos = s.order.indexOf(afterEntry);
        if (pos >= 0) {
          const precedingRemovals = cardUuids.filter((uuid) => {
            const idx = s.order.indexOf(uuid);
            return idx >= 0 && idx <= pos;
          }).length;
          insertIdx = pos + 1 - precedingRemovals;
        }
      }
      // Remove cards from top-level order and all group orders
      const order = s.order.filter((id) => !cardSet.has(id));
      const groups: Record<string, GroupInfo> = {};
      for (const [gid, info] of Object.entries(s.groups)) {
        const filtered = info.order.filter((id) => !cardSet.has(id));
        groups[gid] = filtered.length !== info.order.length ? { ...info, order: filtered } : info;
      }
      // Create new group
      groups[groupId] = { name, order: cardUuids, collapsed: false };
      // Insert group entry into order
      if (insertIdx !== null) {
        const clamped = Math.min(insertIdx, order.length);
        order.splice(clamped, 0, groupEntry);
      } else {
        order.push(groupEntry);
      }
      return { order, groups };
    });
    await createCardboxGroup(groupId, name, cardUuids, afterEntry);
  },
  renameGroup: async (groupId, name) => {
    set((s) => {
      if (!s.groups[groupId]) return s;
      return { groups: { ...s.groups, [groupId]: { ...s.groups[groupId], name } } };
    });
    await renameCardboxGroup(groupId, name);
  },
  dissolveGroup: async (groupId) => {
    set((s) => {
      const group = s.groups[groupId];
      if (!group) return s;
      const members = group.order;
      const groupEntry = `group:${groupId}`;
      const idx = s.order.indexOf(groupEntry);
      const remaining = Object.fromEntries(
        Object.entries(s.groups).filter(([gid]) => gid !== groupId),
      );
      let order: string[];
      if (idx >= 0) {
        order = [...s.order.slice(0, idx), ...members, ...s.order.slice(idx + 1)];
      } else {
        order = [...s.order, ...members];
      }
      return { order, groups: remaining };
    });
    await dissolveCardboxGroup(groupId);
  },
  moveCardToGroup: async (cardUuid, targetGroupId, index) => {
    set((s) => {
      if (!s.groups[targetGroupId]) return s;
      // Remove card from top-level order and all group orders
      const order = s.order.filter((id) => id !== cardUuid);
      const groups: Record<string, GroupInfo> = {};
      for (const [gid, info] of Object.entries(s.groups)) {
        const filtered = info.order.filter((id) => id !== cardUuid);
        groups[gid] = filtered.length !== info.order.length ? { ...info, order: filtered } : info;
      }
      // Insert into target group's order
      const target = groups[targetGroupId]!;
      const targetOrder = [...target.order];
      const insertIdx = index != null ? Math.min(index, targetOrder.length) : targetOrder.length;
      targetOrder.splice(insertIdx, 0, cardUuid);
      groups[targetGroupId] = { name: target.name, collapsed: target.collapsed, order: targetOrder };
      return { order, groups };
    });
    await moveCardToGroupIpc(cardUuid, targetGroupId, index);
  },
  removeCardFromGroup: async (cardUuid, groupId, topLevelIndex) => {
    set((s) => {
      const group = s.groups[groupId];
      if (!group) return s;
      const newGroupOrder = group.order.filter((id) => id !== cardUuid);
      // Insert card into top-level order
      const order = [...s.order];
      const insertIdx = topLevelIndex != null ? Math.min(topLevelIndex, order.length) : order.length;
      order.splice(insertIdx, 0, cardUuid);
      // Auto-dissolve if group becomes empty
      if (newGroupOrder.length === 0) {
        const remaining = Object.fromEntries(
          Object.entries(s.groups).filter(([gid]) => gid !== groupId),
        );
        const prunedOrder = order.filter((id) => id !== `group:${groupId}`);
        return { order: prunedOrder, groups: remaining };
      }
      return {
        order,
        groups: { ...s.groups, [groupId]: { ...group, order: newGroupOrder } },
      };
    });
    await removeCardFromGroupIpc(cardUuid, groupId, topLevelIndex);
  },
  toggleGroupCollapse: async (groupId) => {
    let newCollapsed = false;
    set((s) => {
      const group = s.groups[groupId];
      if (!group) return s;
      newCollapsed = !group.collapsed;
      return {
        groups: { ...s.groups, [groupId]: { ...group, collapsed: newCollapsed } },
      };
    });
    await toggleGroupCollapsed(groupId, newCollapsed);
  },
}));
