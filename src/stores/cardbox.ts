import { create } from "zustand";
import { arrayMove } from "@dnd-kit/sortable";
import type { CardboxAnnotation, GroupInfo, CardNote } from "../lib/ipc";
import { useCardboxUndoStore } from "./cardboxUndo";
import type { UndoEntry } from "./cardboxUndo";
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
  setCardNote,
  clearCardNote,
  exportCardNote,
  setCardColor as setCardColorIpc,
  clearCardColor as clearCardColorIpc,
  batchSetCardColor as batchSetCardColorIpc,
  batchClearCardColor as batchClearCardColorIpc,
  batchPinCards as batchPinCardsIpc,
  batchUnpinCards as batchUnpinCardsIpc,
} from "../lib/ipc";

function pushUndo(entry: UndoEntry & { coalesceKey?: string }) {
  if (useCardboxUndoStore.getState().replayDepth > 0) return;
  const store = useCardboxUndoStore.getState();
  if (entry.coalesceKey) {
    const top = store.undoStack[store.undoStack.length - 1];
    if (top && top.__coalesceKey === entry.coalesceKey) {
      // Replace redo closure, keep original undo closure
      const merged: UndoEntry = { ...top, redo: entry.redo, __coalesceKey: entry.coalesceKey };
      store.replaceTop(merged);
      return;
    }
  }
  const withKey: UndoEntry = { ...entry, __coalesceKey: entry.coalesceKey };
  store.pushUndo(withKey);
}

export type BatchMoveTarget =
  | { type: "topLevel"; insertAtIndex: number }
  | { type: "toGroup"; groupId: string; index?: number };

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
  notes: Record<string, CardNote>;
  layoutVersion: number;
  colors: Record<string, string>;
  connectionsForUuid: string | null;
  connectionsSavedFilters: { searchQuery: string; activeTypes: Set<string> | null } | null;
  fetchAnnotations: () => Promise<void>;
  toggleExpand: (uuid: string) => void;
  collapseAll: () => void;
  setSearchQuery: (query: string) => void;
  toggleType: (type: string) => void;
  resetFilters: () => void;
  enterConnections: (uuid: string) => void;
  exitConnections: () => void;
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
  setNote: (uuid: string, body: string) => Promise<void>;
  clearNote: (uuid: string) => Promise<void>;
  exportNote: (uuid: string) => Promise<string>;
  setCardColor: (uuid: string, color: string) => Promise<void>;
  clearCardColor: (uuid: string) => Promise<void>;
  toggleColor: (color: string) => void;
  batchSetColor: (uuids: string[], color: string) => Promise<void>;
  batchClearColor: (uuids: string[]) => Promise<void>;
  batchPin: (uuids: string[]) => Promise<void>;
  batchUnpin: (uuids: string[]) => Promise<void>;
  batchLink: (uuids: string[]) => Promise<void>;
  batchMoveCards: (uuids: string[], target: BatchMoveTarget) => void;
  batchCreateGroup: (cardUuids: string[], name: string) => Promise<void>;
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
  notes: {},
  layoutVersion: 3,
  colors: {},
  connectionsForUuid: null,
  connectionsSavedFilters: null,
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
        const prunedNotes: Record<string, CardNote> = {};
        for (const [id, note] of Object.entries(s.notes)) {
          if (newUuids.has(id)) prunedNotes[id] = note;
        }
        const prunedColors: Record<string, string> = {};
        for (const [uuid, color] of Object.entries(s.colors)) {
          if (newUuids.has(uuid)) prunedColors[uuid] = color;
        }
        const connectionsStale = s.connectionsForUuid != null && !newUuids.has(s.connectionsForUuid);
        return {
          ...(connectionsStale ? {
            searchQuery: s.connectionsSavedFilters?.searchQuery ?? s.searchQuery,
            connectionsForUuid: null,
            connectionsSavedFilters: null,
          } : {}),
          annotations,
          loading: false,
          activeTypes: connectionsStale
            ? (s.connectionsSavedFilters?.activeTypes ?? types)
            : (s.activeTypes === null && !s.connectionsForUuid ? types : s.activeTypes),
          links: prunedLinks,
          groups: prunedGroups,
          pinned: prunedPinned,
          notes: prunedNotes,
          colors: prunedColors,
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
      connectionsForUuid: null,
      connectionsSavedFilters: null,
    })),
  enterConnections: (uuid) =>
    set((s) => ({
      connectionsSavedFilters: s.connectionsForUuid === null
        ? { searchQuery: s.searchQuery, activeTypes: s.activeTypes }
        : s.connectionsSavedFilters,
      searchQuery: "",
      activeTypes: null,
      connectionsForUuid: uuid,
    })),
  exitConnections: () =>
    set((s) => ({
      searchQuery: s.connectionsSavedFilters?.searchQuery ?? "",
      activeTypes: s.connectionsSavedFilters?.activeTypes ?? null,
      connectionsForUuid: null,
      connectionsSavedFilters: null,
    })),
  setOrder: (order) => set({ order }),
  loadLayout: async () => {
    try {
      const layout = await readCardboxLayout();
      const groups = layout.groups ?? {};
      const notes = layout.notes ?? {};
      const colors = layout.colors ?? {};
      if (layout.order.length > 0) {
        set({ order: layout.order, links: layout.links ?? [], groups, pinned: layout.pinned ?? [], notes, layoutVersion: layout.version, colors });
      } else {
        set({ links: layout.links ?? [], groups, pinned: layout.pinned ?? [], notes, layoutVersion: layout.version, colors });
      }
    } catch {
      // Ignore — use default order from annotations
    }
  },
  saveLayout: async () => {
    const { order, links, groups, pinned, notes, layoutVersion, colors } = get();
    try {
      await writeCardboxLayout({
        version: Math.max(layoutVersion, 3),
        order,
        links,
        groups,
        pinned,
        notes,
        colors,
      });
    } catch {
      // Ignore write failures silently
    }
  },
  addLink: async (a, b) => {
    if (a === b) return;
    const norm: [string, string] = a <= b ? [a, b] : [b, a];
    const already = get().links.some(([x, y]) => x === norm[0] && y === norm[1]);
    if (already) return;
    pushUndo({
      description: "Add link",
      undo: async () => { await get().removeLink(a, b); },
      redo: async () => { await get().addLink(a, b); },
    });
    set((s) => ({ links: [...s.links, norm] }));
    await addCardboxLink(a, b);
  },
  removeLink: async (a, b) => {
    const norm: [string, string] = a <= b ? [a, b] : [b, a];
    const exists = get().links.some(([x, y]) => x === norm[0] && y === norm[1]);
    if (!exists) return;
    pushUndo({
      description: "Remove link",
      undo: async () => { await get().addLink(a, b); },
      redo: async () => { await get().removeLink(a, b); },
    });
    set((s) => ({
      links: s.links.filter(([x, y]) => !(x === norm[0] && y === norm[1])),
    }));
    await removeCardboxLink(a, b);
  },
  createGroup: async (groupId, name, cardUuids, afterEntry) => {
    pushUndo({
      description: "Create group",
      undo: async () => { await get().dissolveGroup(groupId); },
      redo: async () => { await get().createGroup(groupId, name, cardUuids, afterEntry); },
    });
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
    const group = get().groups[groupId];
    if (!group) return;
    const prevName = group.name;
    if (prevName === name) return;
    pushUndo({
      description: "Rename group",
      undo: async () => { await get().renameGroup(groupId, prevName); },
      redo: async () => { await get().renameGroup(groupId, name); },
    });
    set((s) => {
      if (!s.groups[groupId]) return s;
      return { groups: { ...s.groups, [groupId]: { ...s.groups[groupId], name } } };
    });
    await renameCardboxGroup(groupId, name);
  },
  dissolveGroup: async (groupId) => {
    const group = get().groups[groupId];
    if (!group) return;
    const capturedName = group.name;
    const capturedOrder = [...group.order];
    const capturedCollapsed = group.collapsed;
    const groupEntry = `group:${groupId}`;
    const orderArr = get().order;
    const groupIdx = orderArr.indexOf(groupEntry);
    const afterEntry = groupIdx > 0 ? orderArr[groupIdx - 1] : undefined;
    pushUndo({
      description: "Dissolve group",
      undo: async () => {
        await get().createGroup(groupId, capturedName, capturedOrder, afterEntry);
        if (capturedCollapsed) {
          await get().toggleGroupCollapse(groupId);
        }
      },
      redo: async () => { await get().dissolveGroup(groupId); },
    });
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
    // Capture source location for undo
    const prevGroups = get().groups;
    let sourceGroupId: string | null = null;
    let sourceIndex: number | undefined;
    for (const [gid, info] of Object.entries(prevGroups)) {
      const idx = info.order.indexOf(cardUuid);
      if (idx >= 0) {
        sourceGroupId = gid;
        sourceIndex = idx;
        break;
      }
    }
    const topLevelIdx = sourceGroupId === null ? get().order.indexOf(cardUuid) : -1;
    pushUndo({
      description: "Move card to group",
      undo: async () => {
        if (sourceGroupId) {
          await get().moveCardBetweenGroups(cardUuid, targetGroupId, sourceGroupId, sourceIndex);
        } else {
          await get().removeCardFromGroup(cardUuid, targetGroupId, topLevelIdx >= 0 ? topLevelIdx : undefined);
        }
      },
      redo: async () => { await get().moveCardToGroup(cardUuid, targetGroupId, index); },
    });
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
    const group = get().groups[groupId];
    if (!group) return;
    const prevIndex = group.order.indexOf(cardUuid);
    pushUndo({
      description: "Remove card from group",
      undo: async () => { await get().moveCardToGroup(cardUuid, groupId, prevIndex >= 0 ? prevIndex : undefined); },
      redo: async () => { await get().removeCardFromGroup(cardUuid, groupId, topLevelIndex); },
    });
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
    if (get().pinned.includes(uuid)) return;
    pushUndo({
      description: "Pin card",
      undo: async () => { await get().unpinCard(uuid); },
      redo: async () => { await get().pinCard(uuid); },
    });
    set((s) => ({ pinned: [...s.pinned, uuid] }));
    await pinCardboxCard(uuid);
  },
  unpinCard: async (uuid) => {
    if (!get().pinned.includes(uuid)) return;
    pushUndo({
      description: "Unpin card",
      undo: async () => { await get().pinCard(uuid); },
      redo: async () => { await get().unpinCard(uuid); },
    });
    set((s) => ({
      pinned: s.pinned.filter((id) => id !== uuid),
    }));
    await unpinCardboxCard(uuid);
  },
  setPinned: (pinned) => set({ pinned }),
  setNote: async (uuid, body) => {
    const prevNote = get().notes[uuid];
    const prevBody = prevNote?.body;
    const trimmed = body.trim();
    if ((prevBody ?? "") === trimmed) return;
    pushUndo({
      description: "Set note",
      coalesceKey: `setNote:${uuid}`,
      undo: async () => {
        if (prevBody) { await get().setNote(uuid, prevBody); }
        else { await get().clearNote(uuid); }
      },
      redo: async () => { await get().setNote(uuid, body); },
    });
    set((s) => {
      if (!trimmed) {
        const { [uuid]: _omit, ...rest } = s.notes; // eslint-disable-line @typescript-eslint/no-unused-vars
        return { notes: rest };
      }
      return {
        notes: { ...s.notes, [uuid]: { body: trimmed, updated_at: new Date().toISOString() } },
      };
    });
    await setCardNote(uuid, body);
  },
  clearNote: async (uuid) => {
    const prevNote = get().notes[uuid];
    if (!prevNote) return;
    const prevBody = prevNote.body;
    pushUndo({
      description: "Clear note",
      undo: async () => { await get().setNote(uuid, prevBody); },
      redo: async () => { await get().clearNote(uuid); },
    });
    set((s) => {
      const { [uuid]: _omit, ...rest } = s.notes; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { notes: rest };
    });
    await clearCardNote(uuid);
  },
  exportNote: async (uuid) => {
    return exportCardNote(uuid);
  },
  setCardColor: async (uuid, color) => {
    const prevColor = get().colors[uuid];
    if (prevColor === color) return;
    pushUndo({
      description: "Set card color",
      undo: async () => {
        if (prevColor) { await get().setCardColor(uuid, prevColor); }
        else { await get().clearCardColor(uuid); }
      },
      redo: async () => { await get().setCardColor(uuid, color); },
    });
    set((s) => ({
      colors: { ...s.colors, [uuid]: color },
    }));
    await setCardColorIpc(uuid, color);
  },
  clearCardColor: async (uuid) => {
    const prevColor = get().colors[uuid];
    if (!prevColor) return;
    pushUndo({
      description: "Clear card color",
      undo: async () => { await get().setCardColor(uuid, prevColor); },
      redo: async () => { await get().clearCardColor(uuid); },
    });
    set((s) => {
      const { [uuid]: _, ...rest } = s.colors; // eslint-disable-line @typescript-eslint/no-unused-vars
      return { colors: rest };
    });
    await clearCardColorIpc(uuid);
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

  batchSetColor: async (uuids, color) => {
    const prevColors: Record<string, string | undefined> = {};
    const currentColors = get().colors;
    for (const uuid of uuids) {
      prevColors[uuid] = currentColors[uuid];
    }
    pushUndo({
      description: `Set color on ${uuids.length} cards`,
      undo: async () => {
        // Single set() — restore all previous colors in one pass
        set((s) => {
          const next = { ...s.colors };
          for (const [uuid, prev] of Object.entries(prevColors)) {
            if (prev) { next[uuid] = prev; }
            else { delete next[uuid]; }
          }
          return { colors: next };
        });
        // Single batch IPC — split into set vs clear
        const toSet = Object.entries(prevColors)
          .filter(([, prev]) => prev !== undefined)
          .map(([uuid, color]) => ({ uuid, color: color! }));
        const toClear = Object.entries(prevColors)
          .filter(([, prev]) => prev === undefined)
          .map(([uuid]) => uuid);
        if (toSet.length > 0) await batchSetCardColorIpc(toSet);
        if (toClear.length > 0) await batchClearCardColorIpc(toClear);
      },
      redo: async () => { await get().batchSetColor(uuids, color); },
    });
    set((s) => {
      const next = { ...s.colors };
      for (const uuid of uuids) next[uuid] = color;
      return { colors: next };
    });
    await batchSetCardColorIpc(uuids.map((uuid) => ({ uuid, color })));
  },

  batchClearColor: async (uuids) => {
    const prevColors: Record<string, string> = {};
    const currentColors = get().colors;
    for (const uuid of uuids) {
      if (currentColors[uuid]) prevColors[uuid] = currentColors[uuid];
    }
    if (Object.keys(prevColors).length > 0) {
      pushUndo({
        description: `Clear color on ${uuids.length} cards`,
        undo: async () => {
          // Single set() — restore all previous colors
          set((s) => {
            const next = { ...s.colors };
            for (const [uuid, prev] of Object.entries(prevColors)) {
              next[uuid] = prev;
            }
            return { colors: next };
          });
          // Single batch IPC
          const entries = Object.entries(prevColors).map(([uuid, color]) => ({ uuid, color }));
          if (entries.length > 0) await batchSetCardColorIpc(entries);
        },
        redo: async () => { await get().batchClearColor(uuids); },
      });
    }
    set((s) => {
      const next = { ...s.colors };
      for (const uuid of uuids) delete next[uuid];
      return { colors: next };
    });
    await batchClearCardColorIpc(uuids);
  },

  batchPin: async (uuids) => {
    const pinnedSet = new Set(get().pinned);
    const actuallyAdded = uuids.filter((u) => !pinnedSet.has(u));
    if (actuallyAdded.length > 0) {
      pushUndo({
        description: `Pin ${actuallyAdded.length} cards`,
        undo: async () => { await get().batchUnpin(actuallyAdded); },
        redo: async () => { await get().batchPin(actuallyAdded); },
      });
    }
    set((s) => {
      const pinnedSet = new Set(s.pinned);
      const toAdd = uuids.filter((u) => !pinnedSet.has(u));
      if (toAdd.length === 0) return s;
      return { pinned: [...s.pinned, ...toAdd] };
    });
    await batchPinCardsIpc(uuids);
  },

  batchUnpin: async (uuids) => {
    const pinnedSet = new Set(get().pinned);
    const actuallyRemoved = uuids.filter((u) => pinnedSet.has(u));
    if (actuallyRemoved.length > 0) {
      pushUndo({
        description: `Unpin ${actuallyRemoved.length} cards`,
        undo: async () => { await get().batchPin(actuallyRemoved); },
        redo: async () => { await get().batchUnpin(actuallyRemoved); },
      });
    }
    set((s) => {
      const removeSet = new Set(uuids);
      return { pinned: s.pinned.filter((u) => !removeSet.has(u)) };
    });
    await batchUnpinCardsIpc(uuids);
  },

  batchLink: async (uuids) => {
    // Generate all unique pairs and add links optimistically
    const pairs: [string, string][] = [];
    for (let i = 0; i < uuids.length; i++) {
      for (let j = i + 1; j < uuids.length; j++) {
        const a = uuids[i]!, b = uuids[j]!;
        const norm: [string, string] = a <= b ? [a, b] : [b, a];
        pairs.push(norm);
      }
    }
    const existingSet = new Set(get().links.map(([x, y]) => `${x}:${y}`));
    const newPairs = pairs.filter(([x, y]) => !existingSet.has(`${x}:${y}`));
    if (newPairs.length > 0) {
      pushUndo({
        description: `Link ${uuids.length} cards`,
        undo: async () => {
          // Single set() — remove all pairs at once
          set((s) => {
            const removeSet = new Set(newPairs.map(([x, y]) => `${x}:${y}`));
            return { links: s.links.filter(([x, y]) => !removeSet.has(`${x}:${y}`)) };
          });
          // IPC: sequential removeCardboxLink calls (no batch remove IPC exists)
          for (const [a, b] of newPairs) {
            await removeCardboxLink(a, b);
          }
        },
        redo: async () => { await get().batchLink(uuids); },
      });
    }
    set((s) => {
      const existing = new Set(s.links.map(([x, y]) => `${x}:${y}`));
      const toAdd = pairs.filter(([x, y]) => !existing.has(`${x}:${y}`));
      if (toAdd.length === 0) return s;
      return { links: [...s.links, ...toAdd] };
    });
    // IPC: call addCardboxLink per pair (no batch IPC for links)
    for (const [a, b] of newPairs) {
      await addCardboxLink(a, b);
    }
  },

  batchMoveCards: (uuids, target) => {
    const uuidSet = new Set(uuids);
    const prevOrder = [...get().order];
    const prevGroups: Record<string, GroupInfo> = {};
    for (const [gid, info] of Object.entries(get().groups)) {
      prevGroups[gid] = { ...info, order: [...info.order] };
    }

    pushUndo({
      description: `Move ${uuids.length} cards`,
      undo: async () => {
        set({ order: prevOrder, groups: prevGroups });
      },
      redo: async () => {
        set((s) => {
          let order = s.order.filter((id) => !uuidSet.has(id));
          const groups: Record<string, GroupInfo> = {};
          const dissolvedGroupIds: string[] = [];
          for (const [gid, info] of Object.entries(s.groups)) {
            const filtered = info.order.filter((id) => !uuidSet.has(id));
            if (filtered.length === 0) dissolvedGroupIds.push(gid);
            else groups[gid] = filtered.length !== info.order.length ? { ...info, order: filtered } : info;
          }
          if (dissolvedGroupIds.length > 0) {
            const dissolvedSet = new Set(dissolvedGroupIds.map((gid) => `group:${gid}`));
            order = order.filter((id) => !dissolvedSet.has(id));
          }
          if (target.type === "topLevel") {
            const idx = Math.min(target.insertAtIndex, order.length);
            order.splice(idx, 0, ...uuids);
          } else {
            const group = groups[target.groupId];
            if (group) {
              const targetOrder = [...group.order];
              const insertIdx = target.index != null ? Math.min(target.index, targetOrder.length) : targetOrder.length;
              targetOrder.splice(insertIdx, 0, ...uuids);
              groups[target.groupId] = { ...group, order: targetOrder };
            }
          }
          return { order, groups };
        });
      },
    });

    set((s) => {
      // Phase 1: Remove all dragged UUIDs from order and all groups
      let order = s.order.filter((id) => !uuidSet.has(id));
      const groups: Record<string, GroupInfo> = {};
      const dissolvedGroupIds: string[] = [];

      for (const [gid, info] of Object.entries(s.groups)) {
        const filtered = info.order.filter((id) => !uuidSet.has(id));
        if (filtered.length === 0) {
          dissolvedGroupIds.push(gid);
        } else {
          groups[gid] = filtered.length !== info.order.length ? { ...info, order: filtered } : info;
        }
      }

      // Remove dissolved group entries from order
      if (dissolvedGroupIds.length > 0) {
        const dissolvedSet = new Set(dissolvedGroupIds.map((gid) => `group:${gid}`));
        order = order.filter((id) => !dissolvedSet.has(id));
      }

      // Phase 2: Insert at target
      if (target.type === "topLevel") {
        const idx = Math.min(target.insertAtIndex, order.length);
        order.splice(idx, 0, ...uuids);
      } else {
        const group = groups[target.groupId];
        if (group) {
          const targetOrder = [...group.order];
          const insertIdx = target.index != null ? Math.min(target.index, targetOrder.length) : targetOrder.length;
          targetOrder.splice(insertIdx, 0, ...uuids);
          groups[target.groupId] = { ...group, order: targetOrder };
        }
      }

      return { order, groups };
    });
  },

  batchCreateGroup: async (cardUuids, name) => {
    const groupId = crypto.randomUUID();
    const afterEntry = cardUuids.length > 0 ? cardUuids[cardUuids.length - 1] : undefined;
    await get().createGroup(groupId, name, cardUuids, afterEntry);
  },
}));
