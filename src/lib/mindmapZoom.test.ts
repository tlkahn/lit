import { describe, it, expect } from "vitest";
import { invertPoint, computeFitTransform } from "./mindmapZoom";

describe("invertPoint", () => {
  it("identity transform returns same point", () => {
    expect(invertPoint(100, 200, { k: 1, x: 0, y: 0 })).toEqual({ x: 100, y: 200 });
  });

  it("inverts translation only", () => {
    expect(invertPoint(150, 250, { k: 1, x: 50, y: 50 })).toEqual({ x: 100, y: 200 });
  });

  it("inverts scale only", () => {
    expect(invertPoint(200, 400, { k: 2, x: 0, y: 0 })).toEqual({ x: 100, y: 200 });
  });

  it("inverts both translation and scale", () => {
    expect(invertPoint(300, 500, { k: 2, x: 100, y: 100 })).toEqual({ x: 100, y: 200 });
  });

  it("handles fractional scale (k < 1)", () => {
    expect(invertPoint(50, 100, { k: 0.5, x: 0, y: 0 })).toEqual({ x: 100, y: 200 });
  });
});

describe("computeFitTransform", () => {
  it("content fits exactly → centers at identity scale", () => {
    const result = computeFitTransform(
      { x: 0, y: 0, width: 760, height: 560 },
      { width: 800, height: 600 },
      20,
    );
    expect(result.k).toBe(1);
    expect(result.x).toBeCloseTo(20);
    expect(result.y).toBeCloseTo(20);
  });

  it("large content → scales down", () => {
    const result = computeFitTransform(
      { x: 0, y: 0, width: 2000, height: 1000 },
      { width: 800, height: 600 },
      0,
    );
    expect(result.k).toBeLessThan(1);
    expect(result.k).toBeCloseTo(0.4);
  });

  it("narrow content → centers horizontally, k capped at 1", () => {
    const result = computeFitTransform(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 800, height: 600 },
      0,
    );
    expect(result.k).toBe(1);
    expect(result.x).toBeCloseTo(350);
    expect(result.y).toBeCloseTo(250);
  });

  it("negative content bounds → correct offset", () => {
    const result = computeFitTransform(
      { x: -500, y: -300, width: 1000, height: 600 },
      { width: 800, height: 600 },
      0,
    );
    expect(result.k).toBeCloseTo(0.8);
    expect(result.x).toBeCloseTo(400);
    expect(result.y).toBeCloseTo(300);
  });

  it("padding applied", () => {
    const noPad = computeFitTransform(
      { x: 0, y: 0, width: 2000, height: 1000 },
      { width: 800, height: 600 },
      0,
    );
    const withPad = computeFitTransform(
      { x: 0, y: 0, width: 2000, height: 1000 },
      { width: 800, height: 600 },
      40,
    );
    expect(withPad.k).toBeLessThan(noPad.k);
  });

  it("small content → k capped at 1, centered", () => {
    const result = computeFitTransform(
      { x: 0, y: 0, width: 50, height: 50 },
      { width: 800, height: 600 },
      20,
    );
    expect(result.k).toBe(1);
    expect(result.x).toBeCloseTo(375);
    expect(result.y).toBeCloseTo(275);
  });

  it("zero-size viewport → identity fallback", () => {
    const result = computeFitTransform(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 0, height: 0 },
      0,
    );
    expect(result).toEqual({ k: 1, x: 0, y: 0 });
  });
});
