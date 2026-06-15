import { describe, it, expect } from "vitest";
import { computeSpan } from "./computeSpan";

describe("computeSpan", () => {
  it("returns 2 for zero height (gap alone)", () => {
    expect(computeSpan(0, 8, 16)).toBe(2);
  });

  it("returns exact span when height + gap divides evenly", () => {
    expect(computeSpan(40, 8, 16)).toBe(7);
  });

  it("rounds up when height + gap does not divide evenly", () => {
    expect(computeSpan(50, 8, 16)).toBe(9);
  });

  it("computes typical collapsed card height", () => {
    expect(computeSpan(120, 8, 16)).toBe(17);
  });

  it("clamps negative height to 1", () => {
    expect(computeSpan(-10, 8, 16)).toBe(1);
  });
});
