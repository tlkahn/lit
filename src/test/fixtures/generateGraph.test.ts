import { describe, it, expect } from "vitest";
import { generateSyntheticGraph } from "./generateGraph";

describe("generateSyntheticGraph", () => {
  it("produces the requested number of nodes", () => {
    const { subgraph } = generateSyntheticGraph({ nodeCount: 100 });
    expect(subgraph.nodes).toHaveLength(100);
  });

  it("respects stub fraction", () => {
    const { subgraph } = generateSyntheticGraph({ nodeCount: 100, stubFraction: 0.2 });
    const stubs = subgraph.nodes.filter((n) => n.is_stub);
    expect(stubs).toHaveLength(20);
  });

  it("produces approximately edgeDensity * nodeCount edges", () => {
    const { subgraph } = generateSyntheticGraph({ nodeCount: 200, edgeDensity: 3 });
    expect(subgraph.edges.length).toBeGreaterThan(200 * 2);
    expect(subgraph.edges.length).toBeLessThanOrEqual(200 * 3);
  });

  it("produces no self-loops", () => {
    const { subgraph } = generateSyntheticGraph({ nodeCount: 50 });
    for (const [src, tgt] of subgraph.edges) {
      expect(src).not.toBe(tgt);
    }
  });

  it("produces no duplicate edges", () => {
    const { subgraph } = generateSyntheticGraph({ nodeCount: 200 });
    const keys = subgraph.edges.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("pagerank sums to approximately 1.0", () => {
    const { pagerank } = generateSyntheticGraph({ nodeCount: 100 });
    const sum = Object.values(pagerank).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 1);
  });

  it("is deterministic with the same seed", () => {
    const a = generateSyntheticGraph({ nodeCount: 50, seed: 123 });
    const b = generateSyntheticGraph({ nodeCount: 50, seed: 123 });
    expect(a.subgraph.nodes).toEqual(b.subgraph.nodes);
    expect(a.subgraph.edges).toEqual(b.subgraph.edges);
    expect(a.pagerank).toEqual(b.pagerank);
  });

  it("produces different results with different seeds", () => {
    const a = generateSyntheticGraph({ nodeCount: 50, seed: 1 });
    const b = generateSyntheticGraph({ nodeCount: 50, seed: 2 });
    expect(a.subgraph.edges).not.toEqual(b.subgraph.edges);
  });

  it("handles nodeCount of 0", () => {
    const { subgraph, pagerank } = generateSyntheticGraph({ nodeCount: 0 });
    expect(subgraph.nodes).toHaveLength(0);
    expect(subgraph.edges).toHaveLength(0);
    expect(Object.keys(pagerank)).toHaveLength(0);
  });

  it("handles nodeCount of 1", () => {
    const { subgraph } = generateSyntheticGraph({ nodeCount: 1 });
    expect(subgraph.nodes).toHaveLength(1);
    expect(subgraph.edges).toHaveLength(0);
  });
});
