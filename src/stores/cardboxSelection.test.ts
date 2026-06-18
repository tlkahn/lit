import { describe, it, expect, beforeEach } from "vitest";
import { useCardboxSelectionStore } from "./cardboxSelection";

describe("cardboxSelection store", () => {
  beforeEach(() => {
    useCardboxSelectionStore.setState({
      selectedUuids: new Set(),
      lastSelectedUuid: null,
    });
  });

  it("starts empty", () => {
    const state = useCardboxSelectionStore.getState();
    expect(state.selectedUuids.size).toBe(0);
    expect(state.lastSelectedUuid).toBeNull();
  });

  describe("toggleSelect", () => {
    it("adds a uuid to selection", () => {
      useCardboxSelectionStore.getState().toggleSelect("a");
      const state = useCardboxSelectionStore.getState();
      expect(state.selectedUuids.has("a")).toBe(true);
      expect(state.lastSelectedUuid).toBe("a");
    });

    it("removes a uuid if already selected", () => {
      useCardboxSelectionStore.getState().toggleSelect("a");
      useCardboxSelectionStore.getState().toggleSelect("a");
      expect(useCardboxSelectionStore.getState().selectedUuids.has("a")).toBe(false);
    });

    it("accumulates multiple selections", () => {
      useCardboxSelectionStore.getState().toggleSelect("a");
      useCardboxSelectionStore.getState().toggleSelect("b");
      const uuids = useCardboxSelectionStore.getState().selectedUuids;
      expect(uuids.size).toBe(2);
      expect(uuids.has("a")).toBe(true);
      expect(uuids.has("b")).toBe(true);
    });

    it("updates lastSelectedUuid", () => {
      useCardboxSelectionStore.getState().toggleSelect("a");
      useCardboxSelectionStore.getState().toggleSelect("b");
      expect(useCardboxSelectionStore.getState().lastSelectedUuid).toBe("b");
    });
  });

  describe("rangeSelect", () => {
    it("selects contiguous range from anchor to target", () => {
      useCardboxSelectionStore.getState().toggleSelect("b"); // anchor
      useCardboxSelectionStore.getState().rangeSelect("d", ["a", "b", "c", "d", "e"]);
      const uuids = useCardboxSelectionStore.getState().selectedUuids;
      expect(uuids.has("b")).toBe(true);
      expect(uuids.has("c")).toBe(true);
      expect(uuids.has("d")).toBe(true);
      expect(uuids.has("a")).toBe(false);
      expect(uuids.has("e")).toBe(false);
    });

    it("selects backward range", () => {
      useCardboxSelectionStore.getState().toggleSelect("d"); // anchor
      useCardboxSelectionStore.getState().rangeSelect("b", ["a", "b", "c", "d", "e"]);
      const uuids = useCardboxSelectionStore.getState().selectedUuids;
      expect(uuids.has("b")).toBe(true);
      expect(uuids.has("c")).toBe(true);
      expect(uuids.has("d")).toBe(true);
    });

    it("unions with existing selection", () => {
      useCardboxSelectionStore.getState().toggleSelect("a");
      useCardboxSelectionStore.getState().toggleSelect("b"); // anchor
      useCardboxSelectionStore.getState().rangeSelect("d", ["a", "b", "c", "d", "e"]);
      const uuids = useCardboxSelectionStore.getState().selectedUuids;
      expect(uuids.has("a")).toBe(true); // preserved
      expect(uuids.has("b")).toBe(true);
      expect(uuids.has("c")).toBe(true);
      expect(uuids.has("d")).toBe(true);
    });

    it("with no anchor, selects only the target", () => {
      useCardboxSelectionStore.getState().rangeSelect("c", ["a", "b", "c", "d"]);
      const uuids = useCardboxSelectionStore.getState().selectedUuids;
      expect(uuids.size).toBe(1);
      expect(uuids.has("c")).toBe(true);
    });

    it("preserves anchor for consecutive range selects", () => {
      useCardboxSelectionStore.getState().toggleSelect("b");
      useCardboxSelectionStore.getState().rangeSelect("d", ["a", "b", "c", "d", "e"]);
      // Anchor should still be "b"
      expect(useCardboxSelectionStore.getState().lastSelectedUuid).toBe("b");
    });
  });

  describe("selectAll", () => {
    it("replaces selection with all provided uuids", () => {
      useCardboxSelectionStore.getState().toggleSelect("x");
      useCardboxSelectionStore.getState().selectAll(["a", "b", "c"]);
      const uuids = useCardboxSelectionStore.getState().selectedUuids;
      expect(uuids.size).toBe(3);
      expect(uuids.has("x")).toBe(false);
    });

    it("sets lastSelectedUuid to last item", () => {
      useCardboxSelectionStore.getState().selectAll(["a", "b", "c"]);
      expect(useCardboxSelectionStore.getState().lastSelectedUuid).toBe("c");
    });
  });

  describe("clearSelection", () => {
    it("empties the set and nulls lastSelectedUuid", () => {
      useCardboxSelectionStore.getState().toggleSelect("a");
      useCardboxSelectionStore.getState().toggleSelect("b");
      useCardboxSelectionStore.getState().clearSelection();
      const state = useCardboxSelectionStore.getState();
      expect(state.selectedUuids.size).toBe(0);
      expect(state.lastSelectedUuid).toBeNull();
    });
  });
});
