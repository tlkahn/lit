import { describe, it, expect } from "vitest";
import { parsePageMarkers, pageForOffset } from "./pageMarkers";
import type { PageMarker } from "./pageMarkers";

describe("parsePageMarkers", () => {
  it("extracts two markers with page numbers and starting char offsets", () => {
    const text = "<!-- Page 1 -->\nintro\n<!-- Page 2 -->\nmore";
    const markers = parsePageMarkers(text);
    expect(markers).toEqual([
      { page: 1, charOffset: 0 },
      { page: 2, charOffset: text.indexOf("<!-- Page 2 -->") },
    ]);
  });

  it("returns [] for empty string", () => {
    expect(parsePageMarkers("")).toEqual([]);
  });

  it("returns [] for text with no markers", () => {
    expect(parsePageMarkers("just some prose\nno markers here")).toEqual([]);
  });

  it("keeps markers in document order even when page numbers are out of order", () => {
    const text = "<!-- Page 5 -->\nfoo\n<!-- Page 2 -->\nbar";
    const markers = parsePageMarkers(text);
    expect(markers).toEqual([
      { page: 5, charOffset: 0 },
      { page: 2, charOffset: text.indexOf("<!-- Page 2 -->") },
    ]);
  });

  it("tolerates flexible whitespace in the comment", () => {
    const text = "<!--Page 3-->\nx\n<!--   Page   4   -->";
    const markers = parsePageMarkers(text);
    expect(markers).toEqual([
      { page: 3, charOffset: 0 },
      { page: 4, charOffset: text.indexOf("<!--   Page   4   -->") },
    ]);
  });
});

describe("pageForOffset", () => {
  const markers: PageMarker[] = [
    { page: 1, charOffset: 0 },
    { page: 2, charOffset: 50 },
    { page: 3, charOffset: 120 },
  ];

  it("returns 0 for offset before/at the first marker", () => {
    expect(pageForOffset(markers, 0)).toBe(0);
  });

  it("returns 0 for offset between marker 1 and marker 2", () => {
    expect(pageForOffset(markers, 30)).toBe(0);
  });

  it("returns 1 for offset at/after marker 2", () => {
    expect(pageForOffset(markers, 50)).toBe(1);
    expect(pageForOffset(markers, 60)).toBe(1);
  });

  it("returns 2 for offset after the last marker", () => {
    expect(pageForOffset(markers, 200)).toBe(2);
  });

  it("returns 0 for an empty markers array", () => {
    expect(pageForOffset([], 999)).toBe(0);
  });
});
