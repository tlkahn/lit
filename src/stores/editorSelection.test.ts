import { describe, it, expect, beforeEach } from "vitest";
import { useEditorSelectionStore } from "./editorSelection";

describe("editorSelection store", () => {
  beforeEach(() => {
    useEditorSelectionStore.setState({ from: 0, to: 0 });
  });

  it("initial state has from=0, to=0", () => {
    const s = useEditorSelectionStore.getState();
    expect(s.from).toBe(0);
    expect(s.to).toBe(0);
  });

  it("setSelection updates both values", () => {
    useEditorSelectionStore.getState().setSelection(10, 20);
    const s = useEditorSelectionStore.getState();
    expect(s.from).toBe(10);
    expect(s.to).toBe(20);
  });

  it("setSelection back to 0,0 returns to no-selection state", () => {
    useEditorSelectionStore.getState().setSelection(10, 20);
    useEditorSelectionStore.getState().setSelection(0, 0);
    const s = useEditorSelectionStore.getState();
    expect(s.from).toBe(0);
    expect(s.to).toBe(0);
  });
});
