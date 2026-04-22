import { describe, it, expect, vi, beforeEach } from "vitest";
import mermaid from "mermaid";
import { renderMermaid, getMermaidCached, clearMermaidCache } from "./mermaid";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string, code: string) => {
      if (code === "INVALID") throw new Error("Parse error: invalid syntax");
      return { svg: `<svg>${code}</svg>` };
    }),
  },
}));

beforeEach(() => {
  clearMermaidCache();
  vi.clearAllMocks();
});

describe("renderMermaid", () => {
  it("returns SVG string for valid source", async () => {
    const svg = await renderMermaid("graph LR; A-->B", "default");
    expect(svg).toBe("<svg>graph LR; A-->B</svg>");
  });

  it("caches by (source, theme) — second call skips mermaid.render", async () => {
    await renderMermaid("graph LR; A-->B", "default");
    await renderMermaid("graph LR; A-->B", "default");
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it("re-renders when theme changes", async () => {
    await renderMermaid("graph LR; A-->B", "default");
    await renderMermaid("graph LR; A-->B", "dark");
    expect(mermaid.initialize).toHaveBeenCalledTimes(2);
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it("re-renders when source changes", async () => {
    await renderMermaid("graph LR; A-->B", "default");
    await renderMermaid("graph LR; C-->D", "default");
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it("throws with parse error message for invalid source", async () => {
    await expect(renderMermaid("INVALID", "default")).rejects.toThrow(
      "Parse error: invalid syntax",
    );
  });

  it("generates unique element IDs per call", async () => {
    await renderMermaid("graph LR; A-->B", "default");
    await renderMermaid("graph LR; C-->D", "default");
    const calls = vi.mocked(mermaid.render).mock.calls;
    expect(calls[0]![0]).not.toBe(calls[1]![0]);
  });

  it("clearMermaidCache empties the cache", async () => {
    await renderMermaid("graph LR; A-->B", "default");
    expect(getMermaidCached("graph LR; A-->B", "default")).toBeDefined();
    clearMermaidCache();
    expect(getMermaidCached("graph LR; A-->B", "default")).toBeUndefined();
  });
});

describe("getMermaidCached", () => {
  it("returns undefined for uncached entry", () => {
    expect(getMermaidCached("anything", "default")).toBeUndefined();
  });

  it("returns cached SVG after renderMermaid", async () => {
    await renderMermaid("graph LR; X-->Y", "dark");
    expect(getMermaidCached("graph LR; X-->Y", "dark")).toBe(
      "<svg>graph LR; X-->Y</svg>",
    );
  });
});
