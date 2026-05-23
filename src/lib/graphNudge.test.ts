import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Graph from "graphology";
import { createNudgeController, PULL_FRACTION, HOVER_SIZE_BOOST, NEIGHBOR_SIZE_BOOST, LERP, EPSILON } from "./graphNudge";

let rafQueue: Map<number, FrameRequestCallback>;
let rafId: number;

beforeEach(() => {
  rafQueue = new Map();
  rafId = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = ++rafId;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue.delete(id);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function flushRAF(n = 1) {
  for (let i = 0; i < n; i++) {
    const cbs = [...rafQueue.values()];
    rafQueue.clear();
    for (const cb of cbs) cb(performance.now());
  }
}

function makeGraph() {
  const g = new Graph();
  g.addNode("center", { x: 100, y: 100, size: 8 });
  g.addNode("n1", { x: 200, y: 100, size: 8 });
  g.addNode("n2", { x: 100, y: 200, size: 8 });
  g.addNode("far", { x: 300, y: 300, size: 8 });
  g.addUndirectedEdge("center", "n1");
  g.addUndirectedEdge("center", "n2");
  return g;
}

describe("graphNudge", () => {
  describe("constants", () => {
    it("exports expected animation constants", () => {
      expect(PULL_FRACTION).toBe(0.04);
      expect(HOVER_SIZE_BOOST).toBe(1.5);
      expect(NEIGHBOR_SIZE_BOOST).toBe(0.5);
      expect(LERP).toBe(0.12);
      expect(EPSILON).toBe(0.01);
    });
  });

  describe("Cycle 1: factory API shape", () => {
    it("returns { enter, leave, dispose }", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());
      expect(typeof ctrl.enter).toBe("function");
      expect(typeof ctrl.leave).toBe("function");
      expect(typeof ctrl.dispose).toBe("function");
    });
  });

  describe("Cycle 2: enter() grows hovered node", () => {
    it("after enter + one RAF flush, hovered node size moves from 8 toward 9.5", () => {
      const g = makeGraph();
      const refresh = vi.fn();
      const ctrl = createNudgeController(g, refresh);

      ctrl.enter("center");
      flushRAF(1);

      const size = g.getNodeAttribute("center", "size") as number;
      expect(size).toBeGreaterThan(8);
      expect(size).toBeLessThanOrEqual(8 + HOVER_SIZE_BOOST);
    });
  });

  describe("Cycle 3: enter() pulls neighbors", () => {
    it("after enter + one flush, neighbor n1 x < 200 (pulled toward center)", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(1);

      const n1x = g.getNodeAttribute("n1", "x") as number;
      expect(n1x).toBeLessThan(200);
    });

    it("non-neighbor 'far' stays at original position", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(1);

      expect(g.getNodeAttribute("far", "x")).toBe(300);
      expect(g.getNodeAttribute("far", "y")).toBe(300);
      expect(g.getNodeAttribute("far", "size")).toBe(8);
    });

    it("neighbor gets NEIGHBOR_SIZE_BOOST", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(1);

      const n1Size = g.getNodeAttribute("n1", "size") as number;
      expect(n1Size).toBeGreaterThan(8);
      expect(n1Size).toBeLessThanOrEqual(8 + NEIGHBOR_SIZE_BOOST);
    });
  });

  describe("Cycle 4: animation converges and stops", () => {
    it("after many flushes, RAF queue is empty (animation stopped)", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(200);

      expect(rafQueue.size).toBe(0);
    });

    it("final hovered node size is close to target", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(200);

      const size = g.getNodeAttribute("center", "size") as number;
      expect(size).toBeCloseTo(8 + HOVER_SIZE_BOOST, 1);
    });
  });

  describe("Cycle 5: leave() springs back to originals", () => {
    it("after enter + frames + leave + 1 frame, size is decreasing toward 8", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(10);
      const sizeAfterEnter = g.getNodeAttribute("center", "size") as number;

      ctrl.leave();
      flushRAF(1);

      const sizeAfterLeave = g.getNodeAttribute("center", "size") as number;
      expect(sizeAfterLeave).toBeLessThan(sizeAfterEnter);
      expect(sizeAfterLeave).toBeGreaterThan(8);
    });

    it("after full convergence, positions/sizes are exactly restored", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(10);
      ctrl.leave();
      flushRAF(200);

      expect(g.getNodeAttribute("center", "size")).toBe(8);
      expect(g.getNodeAttribute("center", "x")).toBe(100);
      expect(g.getNodeAttribute("center", "y")).toBe(100);
      expect(g.getNodeAttribute("n1", "x")).toBe(200);
      expect(g.getNodeAttribute("n1", "y")).toBe(100);
      expect(g.getNodeAttribute("n1", "size")).toBe(8);
      expect(g.getNodeAttribute("n2", "x")).toBe(100);
      expect(g.getNodeAttribute("n2", "y")).toBe(200);
      expect(g.getNodeAttribute("far", "x")).toBe(300);
      expect(g.getNodeAttribute("far", "y")).toBe(300);
    });
  });

  describe("Cycle 6: dispose() snaps immediately", () => {
    it("after enter + frames + dispose, RAF cancelled and attributes restored", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(5);

      ctrl.dispose();

      expect(rafQueue.size).toBe(0);
      expect(g.getNodeAttribute("center", "size")).toBe(8);
      expect(g.getNodeAttribute("center", "x")).toBe(100);
      expect(g.getNodeAttribute("n1", "x")).toBe(200);
      expect(g.getNodeAttribute("n1", "size")).toBe(8);
    });
  });

  describe("Cycle 7: rapid re-entry resets previous animation", () => {
    it("enter center + frames + enter n1 → center back to original, n1 growing", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(10);

      ctrl.enter("n1");
      flushRAF(1);

      expect(g.getNodeAttribute("center", "size")).toBeCloseTo(8, 0);
      const n1Size = g.getNodeAttribute("n1", "size") as number;
      expect(n1Size).toBeGreaterThan(8);
    });

    it("re-entry during spring-back works correctly", () => {
      const g = makeGraph();
      const ctrl = createNudgeController(g, vi.fn());

      ctrl.enter("center");
      flushRAF(10);
      ctrl.leave();
      flushRAF(3);

      // Re-enter during spring-back
      ctrl.enter("n1");
      flushRAF(1);

      const n1Size = g.getNodeAttribute("n1", "size") as number;
      expect(n1Size).toBeGreaterThan(8);
    });
  });

  describe("Cycle 8: refresh() called every frame", () => {
    it("after 3 flushes, refresh has been called 3 times", () => {
      const g = makeGraph();
      const refresh = vi.fn();
      const ctrl = createNudgeController(g, refresh);

      ctrl.enter("center");
      flushRAF(1);
      flushRAF(1);
      flushRAF(1);

      expect(refresh).toHaveBeenCalledTimes(3);
    });
  });
});
