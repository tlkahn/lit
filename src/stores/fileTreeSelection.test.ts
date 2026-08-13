import { describe, it, expect, beforeEach } from "vitest";
import { useFileTreeSelectionStore } from "./fileTreeSelection";

describe("fileTreeSelection store", () => {
  beforeEach(() => {
    useFileTreeSelectionStore.setState({
      selectedPaths: new Set(),
      lastSelectedPath: null,
    });
  });

  it("starts empty with null anchor", () => {
    const state = useFileTreeSelectionStore.getState();
    expect(state.selectedPaths.size).toBe(0);
    expect(state.lastSelectedPath).toBeNull();
  });

  describe("toggle", () => {
    it("adds a path and updates lastSelectedPath", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      const state = useFileTreeSelectionStore.getState();
      expect(state.selectedPaths.has("a.md")).toBe(true);
      expect(state.lastSelectedPath).toBe("a.md");
    });

    it("removes a path on second toggle", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("a.md");
      expect(useFileTreeSelectionStore.getState().selectedPaths.has("a.md")).toBe(false);
    });

    it("updates lastSelectedPath on each toggle", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("b.md");
      expect(useFileTreeSelectionStore.getState().lastSelectedPath).toBe("b.md");
    });
  });

  describe("setOnly", () => {
    it("replaces the set with one path and sets the anchor", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("b.md");
      useFileTreeSelectionStore.getState().setOnly("c.md");
      const state = useFileTreeSelectionStore.getState();
      expect([...state.selectedPaths]).toEqual(["c.md"]);
      expect(state.lastSelectedPath).toBe("c.md");
    });
  });

  describe("rangeSelect", () => {
    const ordered = ["a.md", "b.md", "c.md", "d.md", "e.md"];

    it("with no anchor acts like setOnly", () => {
      useFileTreeSelectionStore.getState().rangeSelect("c.md", ordered);
      const state = useFileTreeSelectionStore.getState();
      expect([...state.selectedPaths]).toEqual(["c.md"]);
      expect(state.lastSelectedPath).toBe("c.md");
    });

    it("selects forward range from anchor, keeping anchor", () => {
      useFileTreeSelectionStore.getState().toggle("b.md"); // anchor
      useFileTreeSelectionStore.getState().rangeSelect("d.md", ordered);
      const state = useFileTreeSelectionStore.getState();
      expect([...state.selectedPaths].sort()).toEqual(["b.md", "c.md", "d.md"]);
      expect(state.lastSelectedPath).toBe("b.md");
    });

    it("selects backward range from anchor", () => {
      useFileTreeSelectionStore.getState().toggle("d.md"); // anchor
      useFileTreeSelectionStore.getState().rangeSelect("b.md", ordered);
      const state = useFileTreeSelectionStore.getState();
      expect([...state.selectedPaths].sort()).toEqual(["b.md", "c.md", "d.md"]);
      expect(state.lastSelectedPath).toBe("d.md");
    });

    it("unions with pre-existing toggled paths outside the range", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("b.md"); // anchor
      useFileTreeSelectionStore.getState().rangeSelect("d.md", ordered);
      const state = useFileTreeSelectionStore.getState();
      expect(state.selectedPaths.has("a.md")).toBe(true);
      expect(state.selectedPaths.has("b.md")).toBe(true);
      expect(state.selectedPaths.has("c.md")).toBe(true);
      expect(state.selectedPaths.has("d.md")).toBe(true);
      expect(state.selectedPaths.has("e.md")).toBe(false);
    });
  });

  describe("selectAll", () => {
    it("replaces selection with all provided paths", () => {
      useFileTreeSelectionStore.getState().toggle("x.md");
      useFileTreeSelectionStore.getState().selectAll(["a.md", "b.md", "c.md"]);
      const state = useFileTreeSelectionStore.getState();
      expect(state.selectedPaths.size).toBe(3);
      expect(state.selectedPaths.has("x.md")).toBe(false);
    });

    it("sets lastSelectedPath to last list item", () => {
      useFileTreeSelectionStore.getState().selectAll(["a.md", "b.md", "c.md"]);
      expect(useFileTreeSelectionStore.getState().lastSelectedPath).toBe("c.md");
    });
  });

  describe("clear", () => {
    it("empties the set and nulls the anchor", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("b.md");
      useFileTreeSelectionStore.getState().clear();
      const state = useFileTreeSelectionStore.getState();
      expect(state.selectedPaths.size).toBe(0);
      expect(state.lastSelectedPath).toBeNull();
    });
  });

  describe("pruneTo", () => {
    it("drops paths missing from the existing set", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("gone.md");
      useFileTreeSelectionStore.getState().pruneTo(["a.md", "b.md"]);
      const state = useFileTreeSelectionStore.getState();
      expect([...state.selectedPaths]).toEqual(["a.md"]);
    });

    it("keeps lastSelectedPath when still present", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("b.md");
      useFileTreeSelectionStore.getState().pruneTo(["a.md", "b.md"]);
      expect(useFileTreeSelectionStore.getState().lastSelectedPath).toBe("b.md");
    });

    it("nulls lastSelectedPath when pruned", () => {
      useFileTreeSelectionStore.getState().toggle("a.md");
      useFileTreeSelectionStore.getState().toggle("b.md");
      useFileTreeSelectionStore.getState().pruneTo(["a.md"]);
      expect(useFileTreeSelectionStore.getState().lastSelectedPath).toBeNull();
    });
  });
});
