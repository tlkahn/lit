import { describe, it, expect, beforeEach } from "vitest";
import { useGraphViewState } from "./graphViewState";

describe("useGraphViewState", () => {
  beforeEach(() => {
    useGraphViewState.setState({ mode: "full", depth: 2, showCitations: false });
  });

  it("defaults to mode=full, depth=2", () => {
    const state = useGraphViewState.getState();
    expect(state.mode).toBe("full");
    expect(state.depth).toBe(2);
  });

  it("setMode updates mode", () => {
    useGraphViewState.getState().setMode("local");
    expect(useGraphViewState.getState().mode).toBe("local");
  });

  it("setDepth updates depth", () => {
    useGraphViewState.getState().setDepth(3);
    expect(useGraphViewState.getState().depth).toBe(3);
  });

  it("defaults to showCitations=false", () => {
    const state = useGraphViewState.getState();
    expect(state.showCitations).toBe(false);
  });

  it("setShowCitations updates showCitations", () => {
    useGraphViewState.getState().setShowCitations(true);
    expect(useGraphViewState.getState().showCitations).toBe(true);
  });
});
