import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
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
  pinCardboxCard,
  unpinCardboxCard,
  setCardColor as setCardColorIpc,
  clearCardColor as clearCardColorIpc,
} from "../lib/ipc";

export interface CardboxStore {
  annotations: CardboxAnnotation[];
  expandedUuid: string | null;
  loading: boolean;
  searchQuery: string;
  activeTypes: Set<string> | null;
  activeColors: Set<string> | null;
  order: string[];
  links: [string, string][];
  groups: Record<string, GroupInfo>;
  pinned: string[];
  colors: Record<string, string>;
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
  reorderWithinGroup: (groupId: string, activeUuid: string, overUuid: string) => void;
  moveCardBetweenGroups: (cardUuid: string, sourceGroupId: string, targetGroupId: string, index?: number) => Promise<void>;
  pinCard: (uuid: string) => Promise<void>;
  unpinCard: (uuid: string) => Promise<void>;
  setPinned: (pinned: string[]) => void;
  setCardColor: (uuid: string, color: string) => void;
  clearCardColor: (uuid: string) => void;
  toggleColor: (color: string) => void;
}

export const useCardboxStore = create<CardboxStore>((set, get) => ({
  annotations: [],
  expandedUuid: null,
  loading: false,
  searchQuery: "",
  activeTypes: null,
  activeColors: null,
  order: [],
  links: [],
  groups: {},
  pinned: [],
  colors: {},
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
        const prunedPinned = s.pinned.filter((id) => newUuids.has(id));
        return {
          annotations,
          loading: false,
          activeTypes: s.activeTypes === null ? types : s.activeTypes,
          links: prunedLinks,
          groups: prunedGroups,
          pinned: prunedPinned,
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
      activeColors: null,
    })),
  setOrder: (order) => set({ order }),
  loadLayout: async () => {
    try {
      const layout = await readCardboxLayout();
      const groups = layout.groups ?? {};
      const colors = layout.colors ?? {};
      if (layout.order.length > 0) {
        set({ order: layout.order, links: layout.links ?? [], groups, pinned: layout.pinned ?? [], colors });
      } else {
        set({ links: layout.links ?? [], groups, pinned: layout.pinned ?? [], colors });
      }
    } catch {
      // Ignore — use default order from annotations
    }
  },
  saveLayout: async () => {
    const { order, links, groups, pinned, colors } = get();
    const hasGroups = Object.keys(groups).length > 0;
    try {
      await writeCardboxLayout({
        version: Math.max(hasGroups ? 3 : 2, 3),
        order,
        links,
        groups,
        pinned,
        colors,
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
  reorderWithinGroup: (groupId, activeUuid, overUuid) => {
    set((s) => {
      const group = s.groups[groupId];
      if (!group) return s;
      const oldIdx = group.order.indexOf(activeUuid);
      const newIdx = group.order.indexOf(overUuid);
      if (oldIdx === -1 || newIdx === -1) return s;
      const newOrder = arrayMove(group.order, oldIdx, newIdx);
      return {
        groups: { ...s.groups, [groupId]: { ...group, order: newOrder } },
      };
    });
  },
  moveCardBetweenGroups: async (cardUuid, sourceGroupId, targetGroupId, index) => {
    set((s) => {
      const srcGroup = s.groups[sourceGroupId];
      const dstGroup = s.groups[targetGroupId];
      if (!srcGroup || !dstGroup) return s;

      const groups: Record<string, GroupInfo> = { ...s.groups };
      let order = [...s.order];

      // Remove card from source group
      const newSrcOrder = srcGroup.order.filter((id) => id !== cardUuid);

      // Auto-dissolve source group if it becomes empty
      if (newSrcOrder.length === 0) {
        delete groups[sourceGroupId];
        order = order.filter((id) => id !== `group:${sourceGroupId}`);
      } else {
        groups[sourceGroupId] = { ...srcGroup, order: newSrcOrder };
      }

      // Insert card into target group (use fresh ref in case target was modified)
      const target = groups[targetGroupId]!;
      const targetOrder = [...target.order.filter((id) => id !== cardUuid)];
      const insertIdx = index != null ? Math.min(index, targetOrder.length) : targetOrder.length;
      targetOrder.splice(insertIdx, 0, cardUuid);
      groups[targetGroupId] = { ...target, order: targetOrder };

      // Also remove card from top-level order in case it was there
      order = order.filter((id) => id !== cardUuid);

      return { order, groups };
    });
    // IPC: remove from source, then add to target
    await removeCardFromGroupIpc(cardUuid, sourceGroupId);
    await moveCardToGroupIpc(cardUuid, targetGroupId, index);
  },
  pinCard: async (uuid) => {
    set((s) => {
      if (s.pinned.includes(uuid)) return s;
      return { pinned: [...s.pinned, uuid] };
    });
    await pinCardboxCard(uuid);
  },
  unpinCard: async (uuid) => {
    set((s) => ({
      pinned: s.pinned.filter((id) => id !== uuid),
    }));
    await unpinCardboxCard(uuid);
  },
  setPinned: (pinned) => set({ pinned }),
  setCardColor: (uuid, color) => {
    set((s) => ({
      colors: { ...s.colors, [uuid]: color },
    }));
    setCardColorIpc(uuid, color);
  },
  clearCardColor: (uuid) => {
    set((s) => {
      const { [uuid]: _, ...rest } = s.colors;
      return { colors: rest };
    });
    clearCardColorIpc(uuid);
  },
  toggleColor: (color) =>
    set((s) => {
      const next = new Set(s.activeColors);
      if (next.has(color)) {
        next.delete(color);
      } else {
        next.add(color);
      }
      return { activeColors: next };
    }),
}));
