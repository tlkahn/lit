import { create } from "zustand";

export interface CardboxSelectionStore {
  selectedUuids: Set<string>;
  lastSelectedUuid: string | null;
  toggleSelect: (uuid: string) => void;
  rangeSelect: (uuid: string, orderedUuids: string[]) => void;
  selectAll: (uuids: string[]) => void;
  clearSelection: () => void;
}

export const useCardboxSelectionStore = create<CardboxSelectionStore>((set, get) => ({
  selectedUuids: new Set<string>(),
  lastSelectedUuid: null,

  toggleSelect: (uuid) => {
    set((s) => {
      const next = new Set(s.selectedUuids);
      if (next.has(uuid)) {
        next.delete(uuid);
      } else {
        next.add(uuid);
      }
      return { selectedUuids: next, lastSelectedUuid: uuid };
    });
  },

  rangeSelect: (uuid, orderedUuids) => {
    const { lastSelectedUuid, selectedUuids } = get();
    if (!lastSelectedUuid) {
      // No previous anchor -- treat as single select
      set({ selectedUuids: new Set([uuid]), lastSelectedUuid: uuid });
      return;
    }
    const startIdx = orderedUuids.indexOf(lastSelectedUuid);
    const endIdx = orderedUuids.indexOf(uuid);
    if (startIdx === -1 || endIdx === -1) {
      set({ selectedUuids: new Set([uuid]), lastSelectedUuid: uuid });
      return;
    }
    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    const rangeUuids = orderedUuids.slice(lo, hi + 1);
    const next = new Set(selectedUuids);
    for (const u of rangeUuids) next.add(u);
    // lastSelectedUuid stays the same (anchor) so consecutive Shift+Clicks extend from the same anchor
    set({ selectedUuids: next });
  },

  selectAll: (uuids) => {
    set({
      selectedUuids: new Set(uuids),
      lastSelectedUuid: uuids.length > 0 ? uuids[uuids.length - 1] : null,
    });
  },

  clearSelection: () => {
    set({ selectedUuids: new Set(), lastSelectedUuid: null });
  },
}));
