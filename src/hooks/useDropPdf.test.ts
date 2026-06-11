import { describe, it, expect } from "vitest";
import { isInsideRect, filterPdfPaths } from "./useDropPdf";

describe("isInsideRect", () => {
  it("returns true when point is inside the rect", () => {
    expect(isInsideRect(50, 50, new DOMRect(0, 0, 100, 100))).toBe(true);
  });

  it("returns false when point is outside the rect", () => {
    expect(isInsideRect(150, 50, new DOMRect(0, 0, 100, 100))).toBe(false);
  });

  it("returns true for point on the boundary", () => {
    expect(isInsideRect(100, 100, new DOMRect(0, 0, 100, 100))).toBe(true);
  });

  it("returns false when point is above the rect", () => {
    expect(isInsideRect(50, -10, new DOMRect(0, 0, 100, 100))).toBe(false);
  });

  it("returns false when point is to the left of the rect", () => {
    expect(isInsideRect(-1, 50, new DOMRect(0, 0, 100, 100))).toBe(false);
  });

  it("returns false for a zero-area rect even when point matches origin", () => {
    // display:none elements return DOMRect(0,0,0,0) from getBoundingClientRect()
    expect(isInsideRect(0, 0, new DOMRect(0, 0, 0, 0))).toBe(false);
  });
});

describe("filterPdfPaths", () => {
  it("returns only .pdf files (case-insensitive)", () => {
    expect(filterPdfPaths(["/a.pdf", "/b.txt", "/c.PDF", "/d.Pdf"])).toEqual([
      "/a.pdf",
      "/c.PDF",
      "/d.Pdf",
    ]);
  });

  it("returns empty array when no PDFs", () => {
    expect(filterPdfPaths(["/a.txt", "/b.docx"])).toEqual([]);
  });

  it("handles empty input", () => {
    expect(filterPdfPaths([])).toEqual([]);
  });
});
