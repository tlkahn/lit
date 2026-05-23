import { describe, it, expect } from "vitest";
import { get3DQualityTier, get3DTierSettings, get3DQualitySettings } from "./qualityTiers3D";

describe("get3DQualityTier", () => {
  it.each([
    [0, "high"],
    [499, "high"],
    [500, "medium"],
    [1999, "medium"],
    [2000, "low"],
    [4999, "low"],
    [5000, "minimal"],
    [100000, "minimal"],
  ] as const)("nodeCount=%i → %s", (count, expected) => {
    expect(get3DQualityTier(count)).toBe(expected);
  });
});

describe("get3DTierSettings", () => {
  it("returns high tier settings", () => {
    const s = get3DTierSettings("high");
    expect(s).toEqual({
      tier: "high",
      sphereWidthSegments: 16,
      sphereHeightSegments: 12,
      edgeOpacity: 0.5,
      raycastStrategy: "per-frame",
      raycastThrottleMs: 0,
    });
  });

  it("returns medium tier settings", () => {
    const s = get3DTierSettings("medium");
    expect(s.sphereWidthSegments).toBe(8);
    expect(s.sphereHeightSegments).toBe(6);
    expect(s.edgeOpacity).toBe(0.35);
    expect(s.raycastStrategy).toBe("per-frame");
  });

  it("returns low tier settings", () => {
    const s = get3DTierSettings("low");
    expect(s.sphereWidthSegments).toBe(4);
    expect(s.sphereHeightSegments).toBe(3);
    expect(s.edgeOpacity).toBe(0.2);
    expect(s.raycastStrategy).toBe("throttled");
    expect(s.raycastThrottleMs).toBe(100);
  });

  it("returns minimal tier settings", () => {
    const s = get3DTierSettings("minimal");
    expect(s.sphereWidthSegments).toBe(3);
    expect(s.sphereHeightSegments).toBe(2);
    expect(s.edgeOpacity).toBe(0.15);
    expect(s.raycastStrategy).toBe("throttled");
    expect(s.raycastThrottleMs).toBe(200);
  });
});

describe("get3DQualitySettings", () => {
  it("composes tier lookup and settings in one call", () => {
    const s = get3DQualitySettings(1500);
    expect(s.tier).toBe("medium");
    expect(s.sphereWidthSegments).toBe(8);
  });
});
