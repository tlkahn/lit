import { describe, it, expect, beforeEach } from "vitest";
import {
  parsePageMarkers,
  pageForOffset,
  getCachedPageMarkers,
  _resetMarkerCacheForTesting,
} from "./pageMarkers";
import type { PageMarker } from "./pageMarkers";
import { Text } from "@codemirror/state";

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

  it("matches markers with trailing metadata", () => {
    const text = "<!-- Page 1 - 0 images -->\nintro\n<!-- Page 2 - 3 images 1 videos 2 audios -->\nmore";
    const markers = parsePageMarkers(text);
    expect(markers).toEqual([
      { page: 1, charOffset: 0 },
      { page: 2, charOffset: text.indexOf("<!-- Page 2") },
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

describe("getCachedPageMarkers", () => {
  beforeEach(() => {
    _resetMarkerCacheForTesting();
  });

  it("returns correct markers matching parsePageMarkers output", () => {
    const content = "<!-- Page 1 -->\nfoo\n<!-- Page 2 -->\nbar";
    const doc = Text.of(content.split("\n"));
    const result = getCachedPageMarkers(doc);
    const expected = parsePageMarkers(doc.toString());
    expect(result).toEqual(expected);
  });

  it("returns cached result for same Text reference (no re-parse)", () => {
    const content = "<!-- Page 1 -->\nfoo\n<!-- Page 2 -->\nbar";
    const doc = Text.of(content.split("\n"));

    const first = getCachedPageMarkers(doc);
    const second = getCachedPageMarkers(doc);

    // Same reference means the cache was hit, not a fresh parse.
    expect(second).toBe(first);
  });

  it("invalidates cache when Text reference changes", () => {
    const doc1 = Text.of(["<!-- Page 1 -->\nfoo"]);
    const doc2 = Text.of(["<!-- Page 1 -->\nfoo\n<!-- Page 2 -->\nbar"]);

    const result1 = getCachedPageMarkers(doc1);
    const result2 = getCachedPageMarkers(doc2);

    expect(result1).not.toBe(result2);
    expect(result1).toHaveLength(1);
    expect(result2).toHaveLength(2);
  });

  it("invalidates cache when Text identity changes even with same length", () => {
    const doc1 = Text.of(["<!-- Page 1 -->"]);
    const doc2 = Text.of(["<!-- Page 2 -->"]);

    const result1 = getCachedPageMarkers(doc1);
    const result2 = getCachedPageMarkers(doc2);

    expect(result1).not.toBe(result2);
    expect(result1[0]!.page).toBe(1);
    expect(result2[0]!.page).toBe(2);
  });

  it("re-parses after cache reset", () => {
    const content = "<!-- Page 1 -->\nfoo";
    const doc = Text.of(content.split("\n"));

    const first = getCachedPageMarkers(doc);
    _resetMarkerCacheForTesting();
    const second = getCachedPageMarkers(doc);

    // Same doc, but after reset the array is a fresh parse (different reference).
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});
