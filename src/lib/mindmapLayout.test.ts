import { describe, it, expect } from "vitest";
import { estimateTextWidth, computeNodeWidth, truncateText, MIN_NODE_WIDTH, MAX_NODE_WIDTH, NODE_PADDING } from "./mindmapLayout";

describe("estimateTextWidth", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTextWidth("", 14)).toBe(0);
  });

  it("scales with text length", () => {
    const short = estimateTextWidth("Hi", 14);
    const long = estimateTextWidth("Hello World", 14);
    expect(long).toBeGreaterThan(short);
  });

  it("scales with font size", () => {
    const small = estimateTextWidth("Hello", 12);
    const large = estimateTextWidth("Hello", 16);
    expect(large).toBeGreaterThan(small);
  });
});

describe("computeNodeWidth", () => {
  it("returns MIN_NODE_WIDTH for very short text", () => {
    expect(computeNodeWidth("A", 14)).toBe(MIN_NODE_WIDTH);
  });

  it("returns MAX_NODE_WIDTH for very long text", () => {
    const longText = "A".repeat(200);
    expect(computeNodeWidth(longText, 14)).toBe(MAX_NODE_WIDTH);
  });

  it("returns width between min and max for medium text", () => {
    const w = computeNodeWidth("Introduction", 14);
    expect(w).toBeGreaterThan(MIN_NODE_WIDTH);
    expect(w).toBeLessThan(MAX_NODE_WIDTH);
  });

  it("includes padding beyond text width", () => {
    const textW = estimateTextWidth("Hello", 14);
    const nodeW = computeNodeWidth("Hello", 14);
    expect(nodeW).toBeGreaterThanOrEqual(textW + NODE_PADDING);
  });
});

describe("truncateText", () => {
  it("returns original text if it fits", () => {
    expect(truncateText("Hello", 14, 200)).toBe("Hello");
  });

  it("truncates long text and appends '..'", () => {
    const result = truncateText("A".repeat(100), 14, 120);
    expect(result.endsWith("..")).toBe(true);
    expect(result.length).toBeLessThan(100);
  });

  it("never returns just '..'", () => {
    const result = truncateText("ABCDE", 14, MIN_NODE_WIDTH);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});
