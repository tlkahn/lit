import { describe, it, expect } from "vitest";
import { clipRangeToVisible, type CharRange } from "./scopeHighlight";

function r(from: number, to: number): CharRange {
  return { from, to };
}

describe("clipRangeToVisible", () => {
  it("no replaced spans returns the full range", () => {
    expect(clipRangeToVisible(0, 10, [])).toEqual([r(0, 10)]);
  });

  it("range fully contained in one replaced span yields no segments", () => {
    expect(clipRangeToVisible(2, 8, [r(0, 10)])).toEqual([]);
  });

  it("range exactly equal to a replaced span yields no segments", () => {
    expect(clipRangeToVisible(0, 10, [r(0, 10)])).toEqual([]);
  });

  it("replaced span in the middle splits the range into two segments", () => {
    expect(clipRangeToVisible(0, 15, [r(5, 10)])).toEqual([r(0, 5), r(10, 15)]);
  });

  it("replaced span that only touches an edge is not subtracted", () => {
    expect(clipRangeToVisible(0, 5, [r(5, 10)])).toEqual([r(0, 5)]);
    expect(clipRangeToVisible(5, 10, [r(0, 5)])).toEqual([r(5, 10)]);
  });

  it("multiple replaced spans leave only the gaps", () => {
    expect(clipRangeToVisible(0, 30, [r(5, 10), r(15, 20)])).toEqual([
      r(0, 5),
      r(10, 15),
      r(20, 30),
    ]);
  });

  it("unsorted replaced spans still clip correctly", () => {
    expect(clipRangeToVisible(0, 30, [r(15, 20), r(5, 10)])).toEqual([
      r(0, 5),
      r(10, 15),
      r(20, 30),
    ]);
  });

  it("overlapping replaced spans are merged into one hole", () => {
    expect(clipRangeToVisible(0, 30, [r(5, 15), r(10, 20)])).toEqual([
      r(0, 5),
      r(20, 30),
    ]);
  });

  it("replaced span sticking out past the range is clamped", () => {
    expect(clipRangeToVisible(0, 10, [r(5, 20)])).toEqual([r(0, 5)]);
    expect(clipRangeToVisible(5, 15, [r(0, 10)])).toEqual([r(10, 15)]);
  });

  it("zero-width and inverted ranges return empty", () => {
    expect(clipRangeToVisible(5, 5, [])).toEqual([]);
    expect(clipRangeToVisible(10, 3, [])).toEqual([]);
  });

  it("range fully inside a replaced span but not touching the edges yields no segments", () => {
    expect(clipRangeToVisible(2, 8, [r(0, 10)])).toEqual([]);
  });
});
