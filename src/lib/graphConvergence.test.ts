import { describe, it, expect } from "vitest";
import { checkConvergence, type PositionMap, type ConvergenceState } from "./graphConvergence";

describe("graphConvergence", () => {
  const initialState: ConvergenceState = { consecutiveLow: 0 };

  it("identical positions converge after requiredSamples (default 5) calls", () => {
    const positions: PositionMap = { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } };
    let state = initialState;
    for (let i = 0; i < 4; i++) {
      const result = checkConvergence(positions, positions, state);
      expect(result.converged).toBe(false);
      state = result.state;
    }
    const final = checkConvergence(positions, positions, state);
    expect(final.converged).toBe(true);
  });

  it("large displacement resets counter and returns converged=false", () => {
    const prev: PositionMap = { a: { x: 0, y: 0 } };
    const current: PositionMap = { a: { x: 100, y: 100 } };
    const stateWithProgress: ConvergenceState = { consecutiveLow: 4 };
    const result = checkConvergence(prev, current, stateWithProgress);
    expect(result.converged).toBe(false);
    expect(result.state.consecutiveLow).toBe(0);
  });

  it("computes known displacement correctly: {a:{x:0,y:0}} -> {a:{x:3,y:4}} = 5.0", () => {
    const prev: PositionMap = { a: { x: 0, y: 0 } };
    const current: PositionMap = { a: { x: 3, y: 4 } };
    const result = checkConvergence(prev, current, initialState);
    expect(result.displacement).toBe(5.0);
  });

  it("nodes only in prev or only in current are ignored gracefully", () => {
    const prev: PositionMap = { a: { x: 0, y: 0 }, b: { x: 1, y: 1 } };
    const current: PositionMap = { a: { x: 0, y: 0 }, c: { x: 5, y: 5 } };
    const result = checkConvergence(prev, current, initialState);
    expect(result.displacement).toBe(0);
  });

  it("custom threshold and requiredSamples override defaults", () => {
    const prev: PositionMap = { a: { x: 0, y: 0 } };
    const current: PositionMap = { a: { x: 0.1, y: 0 } };
    let state = initialState;
    for (let i = 0; i < 2; i++) {
      const result = checkConvergence(prev, current, state, { threshold: 1.0, requiredSamples: 3 });
      state = result.state;
    }
    const final = checkConvergence(prev, current, state, { threshold: 1.0, requiredSamples: 3 });
    expect(final.converged).toBe(true);
  });

  it("empty maps converge immediately", () => {
    const result = checkConvergence({}, {}, initialState);
    expect(result.converged).toBe(true);
    expect(result.displacement).toBe(0);
  });
});
