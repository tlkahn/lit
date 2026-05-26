import { describe, it, expect } from "vitest";
import { getQualityTier, getTierSettings, getQualitySettings } from "./qualityTiers";

describe("getQualityTier", () => {
  it.each([
    [0, "small"],
    [999, "small"],
    [1000, "medium"],
    [4999, "medium"],
    [5000, "large"],
    [19999, "large"],
    [20000, "huge"],
    [100000, "huge"],
  ] as const)("order=%i → %s", (order, expected) => {
    expect(getQualityTier(order)).toBe(expected);
  });
});

describe("getTierSettings", () => {
  it("small tier enables edge events, threshold=Infinity", () => {
    const s = getTierSettings("small");
    expect(s).toEqual({
      tier: "small",
      labelRenderedSizeThreshold: Infinity,
      enableEdgeEvents: true,
      hideEdgesOnMove: false,
      hideLabelsOnMove: false,
      defaultEdgesHidden: false,
    });
  });

  it("medium tier disables edge events, threshold=Infinity", () => {
    const s = getTierSettings("medium");
    expect(s).toEqual({
      tier: "medium",
      labelRenderedSizeThreshold: Infinity,
      enableEdgeEvents: false,
      hideEdgesOnMove: false,
      hideLabelsOnMove: false,
      defaultEdgesHidden: false,
    });
  });

  it("large tier hides edges/labels on move, threshold=Infinity", () => {
    const s = getTierSettings("large");
    expect(s).toEqual({
      tier: "large",
      labelRenderedSizeThreshold: Infinity,
      enableEdgeEvents: false,
      hideEdgesOnMove: true,
      hideLabelsOnMove: true,
      defaultEdgesHidden: false,
    });
  });

  it("huge tier hides edges by default", () => {
    const s = getTierSettings("huge");
    expect(s).toEqual({
      tier: "huge",
      labelRenderedSizeThreshold: Infinity,
      enableEdgeEvents: false,
      hideEdgesOnMove: true,
      hideLabelsOnMove: true,
      defaultEdgesHidden: true,
    });
  });
});

describe("getQualitySettings", () => {
  it("is a convenience combining getQualityTier + getTierSettings", () => {
    expect(getQualitySettings(500)).toEqual(getTierSettings("small"));
    expect(getQualitySettings(3000)).toEqual(getTierSettings("medium"));
    expect(getQualitySettings(10000)).toEqual(getTierSettings("large"));
    expect(getQualitySettings(50000)).toEqual(getTierSettings("huge"));
  });
});
