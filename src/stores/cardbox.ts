import { create } from "zustand";
import type { CardboxAnnotation, GroupInfo, CardNote } from "../lib/ipc";
import { perfMark, perfMeasure } from "../lib/perf";
import { useCardboxUndoStore } from "./cardboxUndo";
import type { UndoEntry } from "./cardboxUndo";
import { useStatusMessageStore } from "./statusMessage";
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
  syncSlipNoteToSource,
  migrateCardboxSlipNotes,
  exportCardNote,
  setCardColor as setCardColorIpc,
  clearCardColor as clearCardColorIpc,
  batchSetCardColor as batchSetCardColorIpc,
  batchClearCardColor as batchClearCardColorIpc,
  batchPinCards as batchPinCardsIpc,
  batchUnpinCards as batchUnpinCardsIpc,
  mergeCardsToDraft as mergeCardsToDraftIpc,
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

export type BatchMoveTarget = { type: "toGroup"; groupId: string; index?: number };

export interface CardboxStore {
  annotations: CardboxAnnotation[];
  expandedUuid: string | null;
  loading: boolean;
  searchQuery: string;
  activeTypes: Set<string> | null;
  activeColors: Set<string> | null;
  scope: "document" | "workspace";
  links: [string, string][];
  groups: Record<string, GroupInfo>;
  pinned: string[];
  notes: Record<string, CardNote>;
  // Per-uuid slip-note sync bookkeeping: `gen` identifies the latest
  // setNote/clearNote for the uuid (stale resolves must not touch state);
  // `inFlight` counts unresolved syncs (loadLayout must not clobber them).
  noteSyncs: Record<string, { gen: number; inFlight: number }>;
  layoutVersion: number;
  colors: Record<string, string>;
  connectionsForUuid: string | null;
  connectionsSavedFilters: { searchQuery: string; activeTypes: Set<string> | null } | null;
  pendingFocusUuid: string | null;
  pendingHighlightNote: boolean;
  // Quote staged by the Q shortcut, consumed by the target card's note
  // editor (#968).
  pendingNotePrefill: { uuid: string; text: string } | null;
  // True once loadLayout has settled (success or failure). Gates pending-focus
  // consumption: the NOTE highlight needs the layout's notes in the store.
  // Stays true for the session; notes persist in the store across cardbox
  // visits.
  layoutLoaded: boolean;
  setPendingFocusUuid: (uuid: string | null, highlightNote?: boolean) => void;
  setPendingNotePrefill: (prefill: { uuid: string; text: string } | null) => void;
  fetchAnnotations: () => Promise<void>;
  toggleExpand: (uuid: string) => void;
  expand: (uuid: string) => void;
  collapseAll: () => void;
  setSearchQuery: (query: string) => void;
  toggleType: (type: string) => void;
  resetFilters: () => void;
  enterConnections: (uuid: string) => void;
  exitConnections: () => void;
  loadLayout: () => Promise<void>;
  saveLayout: () => Promise<void>;
  addLink: (a: string, b: string) => Promise<void>;
  removeLink: (a: string, b: string) => Promise<void>;
  createGroup: (groupId: string, name: string, cardUuids: string[]) => Promise<void>;
  renameGroup: (groupId: string, name: string) => Promise<void>;
  dissolveGroup: (groupId: string) => Promise<void>;
  moveCardToGroup: (cardUuid: string, targetGroupId: string, index?: number) => Promise<void>;
  removeCardFromGroup: (cardUuid: string, groupId: string) => Promise<void>;
  toggleGroupCollapse: (groupId: string) => Promise<void>;
  moveCardBetweenGroups: (cardUuid: string, sourceGroupId: string, targetGroupId: string, index?: number) => Promise<void>;
  pinCard: (uuid: string) => Promise<void>;
  unpinCard: (uuid: string) => Promise<void>;
  setPinned: (pinned: string[]) => void;
  setNote: (uuid: string, body: string) => Promise<void>;
  clearNote: (uuid: string) => Promise<void>;
  exportNote: (uuid: string) => Promise<string>;
  mergeToDraft: (uuids: string[]) => Promise<string>;
  setCardColor: (uuid: string, color: string) => Promise<void>;
  clearCardColor: (uuid: string) => Promise<void>;
  toggleColor: (color: string) => void;
  setScope: (scope: "document" | "workspace") => void;
  batchSetColor: (uuids: string[], color: string) => Promise<void>;
  batchClearColor: (uuids: string[]) => Promise<void>;
  batchPin: (uuids: string[]) => Promise<void>;
  batchUnpin: (uuids: string[]) => Promise<void>;
  batchLink: (uuids: string[]) => Promise<void>;
  batchMoveCards: (uuids: string[], target: BatchMoveTarget) => Promise<void>;
  batchCreateGroup: (cardUuids: string[], name: string) => Promise<void>;
}

export const useCardboxStore = create<CardboxStore>((set, get) => ({
  annotations: [],
  expandedUuid: null,
  loading: false,
  searchQuery: "",
  activeTypes: null,
  activeColors: null,
  scope: "document",
  links: [],
  groups: {},
  pinned: [],
  notes: {},
  noteSyncs: {},
  layoutVersion: 3,
  colors: {},
  connectionsForUuid: null,
  connectionsSavedFilters: null,
  pendingFocusUuid: null,
  pendingHighlightNote: false,
  pendingNotePrefill: null,
  layoutLoaded: false,
  setPendingFocusUuid: (uuid, highlightNote = false) =>
    set({ pendingFocusUuid: uuid, pendingHighlightNote: uuid ? highlightNote : false }),
  setPendingNotePrefill: (prefill) => set({ pendingNotePrefill: prefill }),
  fetchAnnotations: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      perfMark("cardbox:ipc-start");
      const annotations = await listAllAnnotations();
      perfMeasure("cardbox:ipc", "cardbox:ipc-start");
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
  expand: (uuid) => set({ expandedUuid: uuid }),
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
  setScope: (scope) => set({ scope }),
  // Deliberately preserves scope: the only consumer is pending-focus F2
  // (CardboxView), and flipping scope there would fire scope side effects
  // (collapseAll) that undo the expand the focus path just applied (#972).
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
  loadLayout: async () => {
    // Migrate legacy layout.notes into sn annotations before reading, so the
    // layout's notes map reflects source-backed bodies. Failures never block
    // the read; migration retries on next open.
    try {
      const result = await migrateCardboxSlipNotes();
      const failed = result.failed;
      if (failed > 0) {
        console.warn("[cardbox] slip-note migration failures:", result.failures);
        useStatusMessageStore.getState().show(
          `${failed} note${failed === 1 ? "" : "s"} could not be written to source; will retry next open`,
          "error",
        );
      }
    } catch (e) {
      console.error("[cardbox] slip-note migration failed:", e);
      useStatusMessageStore.getState().show(
        "Slip-note migration failed; will retry next open",
        "error",
      );
    }
    try {
      const layout = await readCardboxLayout();
      const groups = layout.groups ?? {};
      const colors = layout.colors ?? {};
      set((s) => {
        // Apply the read notes, but preserve the in-memory state for any
        // uuid with a sync still in flight: keep the optimistic note if
        // present, keep the deletion (pending clearNote) if absent. This is
        // deliberately not a merge — notes deleted elsewhere must not be
        // resurrected.
        const notes = { ...(layout.notes ?? {}) };
        for (const [uuid, sync] of Object.entries(s.noteSyncs)) {
          if (sync.inFlight <= 0) continue;
          const current = s.notes[uuid];
          if (current) notes[uuid] = current;
          else delete notes[uuid];
        }
        // layout.order is deliberately ignored: document position is the only
        // ordering since #968. saveLayout writes order: [] which migrates the
        // persisted layout on first save.
        return {
          links: layout.links ?? [],
          groups,
          pinned: layout.pinned ?? [],
          notes,
          layoutVersion: layout.version,
          colors,
        };
      });
    } catch {
      // Ignore — use default order from annotations
    }
    // Settle the gate on success AND failure: a pending focus must never hang
    // waiting for a layout that will never arrive.
    set({ layoutLoaded: true });
  },
  saveLayout: async () => {
    const { links, groups, pinned, layoutVersion, colors } = get();
    try {
      await writeCardboxLayout({
        version: Math.max(layoutVersion, 3),
        order: [],
        links,
        groups,
        pinned,
        // Notes are derived from sn annotations on the backend and client
        // notes never merge into cardbox.json; send an empty map.
        notes: {},
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
  createGroup: async (groupId, name, cardUuids) => {
    pushUndo({
      description: "Create group",
      undo: async () => { await get().dissolveGroup(groupId); },
      redo: async () => { await get().createGroup(groupId, name, cardUuids); },
    });
    set((s) => {
      const cardSet = new Set(cardUuids);
      // Remove cards from all other group orders
      const groups: Record<string, GroupInfo> = {};
      for (const [gid, info] of Object.entries(s.groups)) {
        const filtered = info.order.filter((id) => !cardSet.has(id));
        groups[gid] = filtered.length !== info.order.length ? { ...info, order: filtered } : info;
      }
      // Create new group
      groups[groupId] = { name, order: cardUuids, collapsed: false };
      return { groups };
    });
    await createCardboxGroup(groupId, name, cardUuids);
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
    pushUndo({
      description: "Dissolve group",
      undo: async () => {
        await get().createGroup(groupId, capturedName, capturedOrder);
        if (capturedCollapsed) {
          await get().toggleGroupCollapse(groupId);
        }
      },
      redo: async () => { await get().dissolveGroup(groupId); },
    });
    set((s) => {
      if (!s.groups[groupId]) return s;
      const remaining = Object.fromEntries(
        Object.entries(s.groups).filter(([gid]) => gid !== groupId),
      );
      return { groups: remaining };
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
    pushUndo({
      description: "Move card to group",
      undo: async () => {
        if (sourceGroupId) {
          await get().moveCardBetweenGroups(cardUuid, targetGroupId, sourceGroupId, sourceIndex);
        } else {
          await get().removeCardFromGroup(cardUuid, targetGroupId);
        }
      },
      redo: async () => { await get().moveCardToGroup(cardUuid, targetGroupId, index); },
    });
    set((s) => {
      if (!s.groups[targetGroupId]) return s;
      // Remove card from all group orders
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
      return { groups };
    });
    await moveCardToGroupIpc(cardUuid, targetGroupId, index);
  },
  removeCardFromGroup: async (cardUuid, groupId) => {
    const group = get().groups[groupId];
    if (!group) return;
    const prevIndex = group.order.indexOf(cardUuid);
    pushUndo({
      description: "Remove card from group",
      undo: async () => { await get().moveCardToGroup(cardUuid, groupId, prevIndex >= 0 ? prevIndex : undefined); },
      redo: async () => { await get().removeCardFromGroup(cardUuid, groupId); },
    });
    set((s) => {
      const group = s.groups[groupId];
      if (!group) return s;
      const newGroupOrder = group.order.filter((id) => id !== cardUuid);
      // Auto-dissolve if group becomes empty
      if (newGroupOrder.length === 0) {
        const remaining = Object.fromEntries(
          Object.entries(s.groups).filter(([gid]) => gid !== groupId),
        );
        return { groups: remaining };
      }
      return {
        groups: { ...s.groups, [groupId]: { ...group, order: newGroupOrder } },
      };
    });
    await removeCardFromGroupIpc(cardUuid, groupId);
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
  moveCardBetweenGroups: async (cardUuid, sourceGroupId, targetGroupId, index) => {
    set((s) => {
      const srcGroup = s.groups[sourceGroupId];
      const dstGroup = s.groups[targetGroupId];
      if (!srcGroup || !dstGroup) return s;

      const groups: Record<string, GroupInfo> = { ...s.groups };

      // Remove card from source group
      const newSrcOrder = srcGroup.order.filter((id) => id !== cardUuid);

      // Auto-dissolve source group if it becomes empty
      if (newSrcOrder.length === 0) {
        delete groups[sourceGroupId];
      } else {
        groups[sourceGroupId] = { ...srcGroup, order: newSrcOrder };
      }

      // Insert card into target group (use fresh ref in case target was modified)
      const target = groups[targetGroupId]!;
      const targetOrder = [...target.order.filter((id) => id !== cardUuid)];
      const insertIdx = index != null ? Math.min(index, targetOrder.length) : targetOrder.length;
      targetOrder.splice(insertIdx, 0, cardUuid);
      groups[targetGroupId] = { ...target, order: targetOrder };

      return { groups };
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
    const gen = (get().noteSyncs[uuid]?.gen ?? 0) + 1;
    set((s) => {
      const prev = s.noteSyncs[uuid] ?? { gen: 0, inFlight: 0 };
      const noteSyncs = { ...s.noteSyncs, [uuid]: { gen, inFlight: prev.inFlight + 1 } };
      if (!trimmed) {
        const { [uuid]: _omit, ...rest } = s.notes; // eslint-disable-line @typescript-eslint/no-unused-vars
        return { notes: rest, noteSyncs };
      }
      return {
        notes: { ...s.notes, [uuid]: { body: trimmed, updated_at: new Date().toISOString() } },
        noteSyncs,
      };
    });
    try {
      const result = await syncSlipNoteToSource(uuid, trimmed);
      // Align to the source-of-truth timestamp only if this is still the
      // latest sync for this uuid; a stale resolve may carry the same body
      // (A -> B -> A) so body equality is not request identity. Note that
      // updated_at strings arrive in heterogeneous RFC3339 formats (JS
      // toISOString `Z`, Rust to_rfc3339 `+00:00`, day-precision from the
      // DSL) — never order them by string comparison.
      set((s) => {
        const current = s.notes[uuid];
        if (!current || s.noteSyncs[uuid]?.gen !== gen) return s;
        return {
          notes: { ...s.notes, [uuid]: { ...current, updated_at: result.updated_at } },
        };
      });
    } catch {
      // The optimistic value stays until the cardbox reloads; there is no
      // JSON fallback, so a remount or restart before a successful retry
      // loses the edit. Failure is surfaced via the toast below.
      useStatusMessageStore.getState().show("Failed to save note", "error");
    } finally {
      set((s) => {
        const sync = s.noteSyncs[uuid];
        if (!sync) return s;
        return { noteSyncs: { ...s.noteSyncs, [uuid]: { ...sync, inFlight: sync.inFlight - 1 } } };
      });
    }
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
    const gen = (get().noteSyncs[uuid]?.gen ?? 0) + 1;
    set((s) => {
      const prev = s.noteSyncs[uuid] ?? { gen: 0, inFlight: 0 };
      const { [uuid]: _omit, ...rest } = s.notes; // eslint-disable-line @typescript-eslint/no-unused-vars
      return {
        notes: rest,
        noteSyncs: { ...s.noteSyncs, [uuid]: { gen, inFlight: prev.inFlight + 1 } },
      };
    });
    try {
      await syncSlipNoteToSource(uuid, "");
    } catch {
      useStatusMessageStore.getState().show("Failed to save note", "error");
    } finally {
      set((s) => {
        const sync = s.noteSyncs[uuid];
        if (!sync) return s;
        return { noteSyncs: { ...s.noteSyncs, [uuid]: { ...sync, inFlight: sync.inFlight - 1 } } };
      });
    }
  },
  exportNote: async (uuid) => {
    return exportCardNote(uuid);
  },
  mergeToDraft: async (uuids) => {
    return mergeCardsToDraftIpc(uuids);
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

  batchMoveCards: async (uuids, target) => {
    const uuidSet = new Set(uuids);
    const prevGroups: Record<string, GroupInfo> = {};
    for (const [gid, info] of Object.entries(get().groups)) {
      prevGroups[gid] = { ...info, order: [...info.order] };
    }

    const applyMove = () => {
      set((s) => {
        // Phase 1: Remove all moved UUIDs from every group. Emptied groups
        // auto-dissolve — except the target, which must survive to receive
        // the cards in Phase 2 (moving a group's full membership onto that
        // same group must not destroy it).
        const groups: Record<string, GroupInfo> = {};
        for (const [gid, info] of Object.entries(s.groups)) {
          const filtered = info.order.filter((id) => !uuidSet.has(id));
          if (filtered.length === 0 && gid !== target.groupId) continue;
          groups[gid] = filtered.length !== info.order.length ? { ...info, order: filtered } : info;
        }

        // Phase 2: Insert into the target group
        const group = groups[target.groupId];
        if (group) {
          const targetOrder = [...group.order];
          const insertIdx = target.index != null ? Math.min(target.index, targetOrder.length) : targetOrder.length;
          targetOrder.splice(insertIdx, 0, ...uuids);
          groups[target.groupId] = { ...group, order: targetOrder };
        }

        return { groups };
      });
    };

    pushUndo({
      description: `Move ${uuids.length} cards`,
      undo: async () => {
        set({ groups: prevGroups });
        await get().saveLayout();
      },
      redo: async () => {
        applyMove();
        await get().saveLayout();
      },
    });

    applyMove();
    await get().saveLayout();
  },

  batchCreateGroup: async (cardUuids, name) => {
    const groupId = crypto.randomUUID();
    await get().createGroup(groupId, name, cardUuids);
  },
}));
