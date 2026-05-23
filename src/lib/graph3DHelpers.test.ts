import { describe, it, expect } from "vitest";
import {
  computeBoundingSphere,
  computeCameraDistance,
  buildInstanceMatrices,
  buildInstanceColors,
  buildEdgePositions,
  SIZE_SCALE_3D,
} from "./graph3DHelpers";
import { computeNodeSize, MIN_SIZE, SEED_COLOR } from "./graphLayout";
import { Color } from "three";

describe("computeBoundingSphere", () => {
  it("returns zero sphere for empty positions", () => {
    const s = computeBoundingSphere({});
    expect(s.center).toEqual({ x: 0, y: 0, z: 0 });
    expect(s.radius).toBe(0);
  });

  it("returns point sphere for single position", () => {
    const s = computeBoundingSphere({ a: { x: 3, y: 4, z: 5 } });
    expect(s.center).toEqual({ x: 3, y: 4, z: 5 });
    expect(s.radius).toBe(0);
  });

  it("returns midpoint and half-distance for two points", () => {
    const s = computeBoundingSphere({
      a: { x: 0, y: 0, z: 0 },
      b: { x: 10, y: 0, z: 0 },
    });
    expect(s.center.x).toBeCloseTo(5);
    expect(s.center.y).toBeCloseTo(0);
    expect(s.center.z).toBeCloseTo(0);
    expect(s.radius).toBeCloseTo(5);
  });

  it("handles 3D cluster", () => {
    const s = computeBoundingSphere({
      a: { x: 1, y: 1, z: 1 },
      b: { x: -1, y: -1, z: -1 },
      c: { x: 1, y: -1, z: 0 },
    });
    expect(s.center.x).toBeCloseTo(1 / 3);
    expect(s.radius).toBeGreaterThan(0);
  });
});

describe("computeCameraDistance", () => {
  it("returns minimum for zero radius", () => {
    expect(computeCameraDistance(0, 75)).toBe(5);
  });

  it("returns positive distance for nonzero radius", () => {
    const d = computeCameraDistance(10, 75);
    expect(d).toBeGreaterThan(0);
  });

  it("is monotonic in radius", () => {
    const d1 = computeCameraDistance(5, 75);
    const d2 = computeCameraDistance(10, 75);
    expect(d2).toBeGreaterThan(d1);
  });
});

describe("buildInstanceMatrices", () => {
  it("returns empty array for no nodes", () => {
    const m = buildInstanceMatrices([], {}, {});
    expect(m.length).toBe(0);
  });

  it("returns N×16 floats", () => {
    const nodes = [
      { id: "a", title: "A", is_stub: false },
      { id: "b", title: "B", is_stub: false },
    ];
    const m = buildInstanceMatrices(nodes, { a: { x: 1, y: 2, z: 3 } }, { a: 0.5, b: 0.1 });
    expect(m.length).toBe(32);
  });

  it("encodes position in column-major indices [12,13,14]", () => {
    const nodes = [{ id: "a", title: "A", is_stub: false }];
    const m = buildInstanceMatrices(nodes, { a: { x: 7, y: 8, z: 9 } }, { a: 0.5 });
    expect(m[12]).toBe(7);
    expect(m[13]).toBe(8);
    expect(m[14]).toBe(9);
  });

  it("encodes scale on diagonal [0,5,10]", () => {
    const nodes = [{ id: "a", title: "A", is_stub: false }];
    const pr = { a: 0.5 };
    const m = buildInstanceMatrices(nodes, { a: { x: 0, y: 0, z: 0 } }, pr);
    const expectedSize = computeNodeSize(0.5, 0.5) * SIZE_SCALE_3D;
    expect(m[0]).toBeCloseTo(expectedSize);
    expect(m[5]).toBeCloseTo(expectedSize);
    expect(m[10]).toBeCloseTo(expectedSize);
  });

  it("uses uniform MIN_SIZE scale when pagerank is empty", () => {
    const nodes = [
      { id: "a", title: "A", is_stub: false },
      { id: "b", title: "B", is_stub: false },
    ];
    const m = buildInstanceMatrices(
      nodes,
      { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 1, z: 1 } },
      {},
    );
    const expectedSize = MIN_SIZE * SIZE_SCALE_3D;
    expect(m[0]).toBeCloseTo(expectedSize);
    expect(m[16]).toBeCloseTo(expectedSize);
    expect(m[0]).toBe(m[16]);
  });

  it("uses origin for missing position", () => {
    const nodes = [{ id: "a", title: "A", is_stub: false }];
    const m = buildInstanceMatrices(nodes, {}, {});
    expect(m[12]).toBe(0);
    expect(m[13]).toBe(0);
    expect(m[14]).toBe(0);
  });

  it("interleaves multiple nodes correctly", () => {
    const nodes = [
      { id: "a", title: "A", is_stub: false },
      { id: "b", title: "B", is_stub: false },
    ];
    const m = buildInstanceMatrices(
      nodes,
      { a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } },
      { a: 0.5, b: 0.3 },
    );
    expect(m[12]).toBe(1);
    expect(m[13]).toBe(2);
    expect(m[14]).toBe(3);
    expect(m[16 + 12]).toBe(4);
    expect(m[16 + 13]).toBe(5);
    expect(m[16 + 14]).toBe(6);
  });
});

describe("buildInstanceColors", () => {
  const accent = "#0969da";
  const stub = "#818b98";

  it("assigns accent color to real nodes", () => {
    const nodes = [{ id: "a", title: "A", is_stub: false }];
    const c = buildInstanceColors(nodes, accent, stub);
    const expected = new Color(accent);
    expect(c[0]).toBeCloseTo(expected.r);
    expect(c[1]).toBeCloseTo(expected.g);
    expect(c[2]).toBeCloseTo(expected.b);
  });

  it("assigns stub color to stub nodes", () => {
    const nodes = [{ id: "a", title: "A", is_stub: true }];
    const c = buildInstanceColors(nodes, accent, stub);
    const expected = new Color(stub);
    expect(c[0]).toBeCloseTo(expected.r);
    expect(c[1]).toBeCloseTo(expected.g);
    expect(c[2]).toBeCloseTo(expected.b);
  });

  it("assigns seed color to seed node", () => {
    const nodes = [{ id: "a", title: "A", is_stub: false }];
    const c = buildInstanceColors(nodes, accent, stub, "a");
    const expected = new Color(SEED_COLOR);
    expect(c[0]).toBeCloseTo(expected.r);
    expect(c[1]).toBeCloseTo(expected.g);
    expect(c[2]).toBeCloseTo(expected.b);
  });

  it("interleaves multiple node colors correctly", () => {
    const nodes = [
      { id: "a", title: "A", is_stub: false },
      { id: "b", title: "B", is_stub: true },
      { id: "c", title: "C", is_stub: false },
    ];
    const c = buildInstanceColors(nodes, accent, stub, "c");
    expect(c.length).toBe(9);
    const accentC = new Color(accent);
    const stubC = new Color(stub);
    const seedC = new Color(SEED_COLOR);
    expect(c[0]).toBeCloseTo(accentC.r);
    expect(c[3]).toBeCloseTo(stubC.r);
    expect(c[6]).toBeCloseTo(seedC.r);
  });
});

describe("buildEdgePositions", () => {
  it("returns empty array for empty edges", () => {
    const p = buildEdgePositions([], {});
    expect(p.length).toBe(0);
  });

  it("returns 6 floats for single valid edge", () => {
    const edges: [string, string][] = [["a", "b"]];
    const pos = { a: { x: 1, y: 2, z: 3 }, b: { x: 4, y: 5, z: 6 } };
    const p = buildEdgePositions(edges, pos);
    expect(p.length).toBe(6);
    expect(Array.from(p)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("skips edges with missing endpoints", () => {
    const edges: [string, string][] = [["a", "b"], ["a", "c"]];
    const pos = { a: { x: 0, y: 0, z: 0 }, b: { x: 1, y: 1, z: 1 } };
    const p = buildEdgePositions(edges, pos);
    expect(p.length).toBe(6);
  });

  it("handles multiple valid edges", () => {
    const edges: [string, string][] = [["a", "b"], ["b", "c"]];
    const pos = {
      a: { x: 0, y: 0, z: 0 },
      b: { x: 1, y: 1, z: 1 },
      c: { x: 2, y: 2, z: 2 },
    };
    const p = buildEdgePositions(edges, pos);
    expect(p.length).toBe(12);
  });

  it("returns empty for all-missing endpoints", () => {
    const edges: [string, string][] = [["x", "y"]];
    const p = buildEdgePositions(edges, {});
    expect(p.length).toBe(0);
  });
});
