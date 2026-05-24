import { describe, it, expect, beforeEach } from "vitest";
import { useGraphSelectionStore } from "./graphSelection";

describe("graphSelection store", () => {
  beforeEach(() => {
    useGraphSelectionStore.setState({
      selectedNodes: [],
      selectionMode: "none",
    });
  });

  // 2A-1
  it("initializes with empty selectedNodes and selectionMode 'none'", () => {
    const state = useGraphSelectionStore.getState();
    expect(state.selectedNodes).toEqual([]);
    expect(state.selectionMode).toBe("none");
  });

  // 2A-2
  it("toggleNode adds a node when absent", () => {
    useGraphSelectionStore.getState().toggleNode("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual(["a.md"]);
  });

  // 2A-3
  it("toggleNode removes a node when present", () => {
    useGraphSelectionStore.getState().toggleNode("a.md");
    useGraphSelectionStore.getState().toggleNode("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual([]);
  });

  // 2A-4
  it("toggle a/b/c, remove b, add d → preserves order", () => {
    const { toggleNode } = useGraphSelectionStore.getState();
    toggleNode("a.md");
    toggleNode("b.md");
    toggleNode("c.md");
    toggleNode("b.md"); // remove
    toggleNode("d.md"); // add
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual(["a.md", "c.md", "d.md"]);
  });

  // 2A-5
  it("addNode is idempotent", () => {
    const { addNode } = useGraphSelectionStore.getState();
    addNode("a.md");
    addNode("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual(["a.md"]);
  });

  // 2A-6
  it("removeNode removes an existing node", () => {
    const { addNode, removeNode } = useGraphSelectionStore.getState();
    addNode("a.md");
    addNode("b.md");
    removeNode("a.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual(["b.md"]);
  });

  // 2A-7
  it("removeNode on absent node is a no-op", () => {
    const { addNode, removeNode } = useGraphSelectionStore.getState();
    addNode("a.md");
    removeNode("z.md");
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual(["a.md"]);
  });

  // 2A-8
  it("setNodes replaces selection", () => {
    const { addNode, setNodes } = useGraphSelectionStore.getState();
    addNode("a.md");
    setNodes(["b.md", "c.md"]);
    expect(useGraphSelectionStore.getState().selectedNodes).toEqual(["b.md", "c.md"]);
  });

  // 2A-9
  it("clearSelection resets selectedNodes and selectionMode", () => {
    const { toggleNode, clearSelection } = useGraphSelectionStore.getState();
    toggleNode("a.md");
    clearSelection();
    const state = useGraphSelectionStore.getState();
    expect(state.selectedNodes).toEqual([]);
    expect(state.selectionMode).toBe("none");
  });

  // 2A-10
  it("isSelected returns true/false correctly", () => {
    const { toggleNode, isSelected } = useGraphSelectionStore.getState();
    toggleNode("a.md");
    expect(isSelected("a.md")).toBe(true);
    expect(isSelected("b.md")).toBe(false);
  });

  // 2A-11
  it("toggleNode sets mode to 'click'; toggling last node resets to 'none'", () => {
    const { toggleNode } = useGraphSelectionStore.getState();
    toggleNode("a.md");
    expect(useGraphSelectionStore.getState().selectionMode).toBe("click");
    toggleNode("a.md");
    expect(useGraphSelectionStore.getState().selectionMode).toBe("none");
  });
});
