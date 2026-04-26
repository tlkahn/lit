import { describe, it, expect } from "vitest";
import { estimateTextWidth, computeNodeWidth, wrapText, computeNodeHeight, MIN_NODE_WIDTH, MAX_NODE_WIDTH, NODE_PADDING } from "./mindmapLayout";

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

  it("CJK characters are wider than Latin characters", () => {
    const latin = estimateTextWidth("AB", 14);
    const cjk = estimateTextWidth("你好", 14);
    expect(cjk).toBeGreaterThan(latin);
  });

  it("CJK character width equals fontSize", () => {
    expect(estimateTextWidth("中", 14)).toBe(14);
    expect(estimateTextWidth("中", 16)).toBe(16);
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

describe("wrapText", () => {
  it("returns single-element array for short text", () => {
    expect(wrapText("Hello", 14, MAX_NODE_WIDTH)).toEqual(["Hello"]);
  });

  it("wraps multi-word text at word boundaries", () => {
    const longText = "This is a fairly long heading that should wrap to multiple lines";
    const result = wrapText(longText, 14, MAX_NODE_WIDTH);
    expect(result.length).toBeGreaterThan(1);
    for (const line of result) {
      expect(estimateTextWidth(line, 14)).toBeLessThanOrEqual(MAX_NODE_WIDTH - NODE_PADDING);
    }
  });

  it("breaks single long word at character boundary", () => {
    const longWord = "A".repeat(100);
    const result = wrapText(longWord, 14, MAX_NODE_WIDTH);
    expect(result.length).toBeGreaterThan(1);
    for (const line of result) {
      expect(estimateTextWidth(line, 14)).toBeLessThanOrEqual(MAX_NODE_WIDTH - NODE_PADDING);
    }
  });

  it("returns [''] for empty string", () => {
    expect(wrapText("", 14, MAX_NODE_WIDTH)).toEqual([""]);
  });

  it("produces 3+ lines for very long text", () => {
    const veryLong = Array(20).fill("word").join(" ");
    const result = wrapText(veryLong, 14, MAX_NODE_WIDTH);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it("each line fits within maxWidth - NODE_PADDING", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve";
    const result = wrapText(text, 14, 150);
    for (const line of result) {
      expect(estimateTextWidth(line, 14)).toBeLessThanOrEqual(150 - NODE_PADDING);
    }
  });

  it("preserves all text content across lines", () => {
    const text = "hello world foo bar baz";
    const result = wrapText(text, 14, 100);
    expect(result.join(" ")).toBe(text);
  });

  it("breaks long CJK word at correct character boundary", () => {
    const cjk = "中".repeat(30);
    const result = wrapText(cjk, 15, MAX_NODE_WIDTH);
    expect(result.length).toBeGreaterThan(1);
    for (const line of result) {
      expect(estimateTextWidth(line, 15)).toBeLessThanOrEqual(MAX_NODE_WIDTH - NODE_PADDING);
    }
    expect(result.join("")).toBe(cjk);
  });

  it("CJK text that fits in one line stays single line", () => {
    const cjk = "三、循环的主体";
    const result = wrapText(cjk, 15, MAX_NODE_WIDTH);
    expect(result).toEqual([cjk]);
  });
});

describe("computeNodeHeight", () => {
  it("returns fontSize + 8 for 1 line (backward compat)", () => {
    expect(computeNodeHeight(1, 14)).toBe(14 + 8);
  });

  it("returns taller height for 2 lines", () => {
    expect(computeNodeHeight(2, 14)).toBeGreaterThan(computeNodeHeight(1, 14));
  });

  it("scales linearly with line count", () => {
    const h1 = computeNodeHeight(1, 14);
    const h2 = computeNodeHeight(2, 14);
    const h3 = computeNodeHeight(3, 14);
    expect(h3 - h2).toBe(h2 - h1);
  });
});
