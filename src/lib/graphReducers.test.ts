import { describe, it, expect } from "vitest";
import { defaultNodeReduce, hoverNodeReduce, searchNodeReduce } from "./graphReducers";
import type { ReducerContext, HoverContext, SearchContext } from "./graphReducers";
import { SELECTED_COLOR } from "./graphLayout";

describe("defaultNodeReduce", () => {
  const baseAttrs = { color: "#000", label: "Test", size: 10 };

  it("unselected node: forceLabel false, no highlighted", () => {
    const ctx: ReducerContext = { selectedSet: new Set(), dimColor: "#ddd" };
    const result = defaultNodeReduce("a", baseAttrs, ctx);
    expect(result.forceLabel).toBe(false);
    expect(result.highlighted).toBeUndefined();
    expect(result.label).toBe("Test");
  });

  it("selected node: forceLabel true, highlighted true, SELECTED_COLOR", () => {
    const ctx: ReducerContext = { selectedSet: new Set(["a"]), dimColor: "#ddd" };
    const result = defaultNodeReduce("a", baseAttrs, ctx);
    expect(result.forceLabel).toBe(true);
    expect(result.highlighted).toBe(true);
    expect(result.color).toBe(SELECTED_COLOR);
    expect(result.label).toBe("Test");
  });

  it("non-selected node when others selected: forceLabel false, no highlighted", () => {
    const ctx: ReducerContext = { selectedSet: new Set(["b"]), dimColor: "#ddd" };
    const result = defaultNodeReduce("a", baseAttrs, ctx);
    expect(result.forceLabel).toBe(false);
    expect(result.highlighted).toBeUndefined();
  });

  it("preserves all original attrs", () => {
    const ctx: ReducerContext = { selectedSet: new Set(), dimColor: "#ddd" };
    const result = defaultNodeReduce("a", baseAttrs, ctx);
    expect(result.color).toBe("#000");
    expect(result.size).toBe(10);
    expect(result.label).toBe("Test");
  });

  it("empty selectedSet: no nodes get forceLabel true", () => {
    const ctx: ReducerContext = { selectedSet: new Set(), dimColor: "#ddd" };
    expect(defaultNodeReduce("a", baseAttrs, ctx).forceLabel).toBe(false);
    expect(defaultNodeReduce("b", baseAttrs, ctx).forceLabel).toBe(false);
  });
});

describe("hoverNodeReduce", () => {
  const baseAttrs = { color: "#000", label: "Test", size: 10 };
  const makeCtx = (overrides?: Partial<HoverContext>): HoverContext => ({
    selectedSet: new Set(),
    dimColor: "#ddd",
    hoveredNode: "h",
    neighbors: new Set(["h", "n1"]),
    ...overrides,
  });

  it("hovered node: forceLabel true, original color preserved", () => {
    const result = hoverNodeReduce("h", baseAttrs, makeCtx());
    expect(result.forceLabel).toBe(true);
    expect(result.color).toBe("#000");
  });

  it("hovered + selected: forceLabel true, highlighted true, SELECTED_COLOR", () => {
    const result = hoverNodeReduce("h", baseAttrs, makeCtx({ selectedSet: new Set(["h"]) }));
    expect(result.forceLabel).toBe(true);
    expect(result.highlighted).toBe(true);
    expect(result.color).toBe(SELECTED_COLOR);
  });

  it("neighbor, not selected: forceLabel false, original color", () => {
    const result = hoverNodeReduce("n1", baseAttrs, makeCtx());
    expect(result.forceLabel).toBe(false);
    expect(result.color).toBe("#000");
  });

  it("neighbor, selected: forceLabel true, highlighted true, SELECTED_COLOR", () => {
    const result = hoverNodeReduce("n1", baseAttrs, makeCtx({ selectedSet: new Set(["n1"]) }));
    expect(result.forceLabel).toBe(true);
    expect(result.highlighted).toBe(true);
    expect(result.color).toBe(SELECTED_COLOR);
  });

  it("non-neighbor, not selected: dimmed color, forceLabel false", () => {
    const result = hoverNodeReduce("far", baseAttrs, makeCtx());
    expect(result.color).toBe("#ddd");
    expect(result.forceLabel).toBe(false);
  });

  it("non-neighbor, selected: SELECTED_COLOR, forceLabel true, highlighted true", () => {
    const result = hoverNodeReduce("far", baseAttrs, makeCtx({ selectedSet: new Set(["far"]) }));
    expect(result.color).toBe(SELECTED_COLOR);
    expect(result.forceLabel).toBe(true);
    expect(result.highlighted).toBe(true);
  });
});

describe("searchNodeReduce", () => {
  const baseAttrs = { color: "#000", label: "Test", size: 10 };
  const makeCtx = (overrides?: Partial<SearchContext>): SearchContext => ({
    selectedSet: new Set(),
    dimColor: "#ddd",
    matchSet: new Set(["m1"]),
    ...overrides,
  });

  it("matching node: highlighted true, forceLabel true, original color", () => {
    const result = searchNodeReduce("m1", baseAttrs, makeCtx());
    expect(result.highlighted).toBe(true);
    expect(result.forceLabel).toBe(true);
    expect(result.color).toBe("#000");
  });

  it("non-matching, selected: SELECTED_COLOR, forceLabel true, highlighted true", () => {
    const result = searchNodeReduce("other", baseAttrs, makeCtx({ selectedSet: new Set(["other"]) }));
    expect(result.color).toBe(SELECTED_COLOR);
    expect(result.forceLabel).toBe(true);
    expect(result.highlighted).toBe(true);
  });

  it("matching, selected: SELECTED_COLOR, highlighted true, forceLabel true", () => {
    const result = searchNodeReduce("m1", baseAttrs, makeCtx({ selectedSet: new Set(["m1"]) }));
    expect(result.color).toBe(SELECTED_COLOR);
    expect(result.highlighted).toBe(true);
    expect(result.forceLabel).toBe(true);
  });

  it("non-matching, unselected: dimmed, forceLabel false, no highlighted", () => {
    const result = searchNodeReduce("other", baseAttrs, makeCtx());
    expect(result.color).toBe("#ddd");
    expect(result.forceLabel).toBe(false);
    expect(result.highlighted).toBeUndefined();
  });
});
