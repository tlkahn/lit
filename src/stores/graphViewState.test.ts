import { describe, it, expect, beforeEach } from "vitest";
import { useGraphViewState, DEFAULT_EDGE_FILTERS } from "./graphViewState";

describe("useGraphViewState", () => {
  beforeEach(() => {
    useGraphViewState.setState({ mode: "full", depth: 2, edgeFilters: DEFAULT_EDGE_FILTERS });
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

  it("defaults to edgeFilters matching DEFAULT_EDGE_FILTERS", () => {
    const state = useGraphViewState.getState();
    expect(state.edgeFilters).toEqual(DEFAULT_EDGE_FILTERS);
  });

  it("setEdgeFilter updates a single filter key", () => {
    useGraphViewState.getState().setEdgeFilter("citations", true);
    expect(useGraphViewState.getState().edgeFilters.citations).toBe(true);
  });
});
