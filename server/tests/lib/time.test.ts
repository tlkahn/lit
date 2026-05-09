import { nowEpochSeconds, isOlderThan } from "../../src/lib/time.js";

describe("nowEpochSeconds", () => {
  it("returns number within 2s of Date.now()/1000", () => {
    const result = nowEpochSeconds();
    const expected = Math.floor(Date.now() / 1000);
    expect(result).toBeTypeOf("number");
    expect(Math.abs(result - expected)).toBeLessThanOrEqual(2);
  });
});

describe("isOlderThan", () => {
  it("returns true for timestamps older than maxAgeSecs", () => {
    const oldTimestamp = nowEpochSeconds() - 3600 - 1;
    expect(isOlderThan(oldTimestamp, 3600)).toBe(true);
  });

  it("returns false for timestamps within window", () => {
    const recentTimestamp = nowEpochSeconds() - 1800;
    expect(isOlderThan(recentTimestamp, 3600)).toBe(false);
  });

  it("returns false at exact boundary", () => {
    const boundaryTimestamp = nowEpochSeconds() - 3600;
    expect(isOlderThan(boundaryTimestamp, 3600)).toBe(false);
  });
});
