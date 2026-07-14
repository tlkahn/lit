import { describe, it, expect } from "vitest";
import { resolvePendingSection } from "./sectionTarget";

const doc = [
  "# Intro",          // 0-6, line starts at 0
  "",                 // 8
  "Some text here.",  // 9-24
  "",
  "## Details",
  "",
  "First block. ^3141e2",
  "",
  "Plain closing line.",
].join("\n");

describe("resolvePendingSection", () => {
  it("resolves a heading section to its from, with no flash", () => {
    const result = resolvePendingSection(doc, "Details");
    expect(result).not.toBeNull();
    expect(doc.slice(result!.pos, result!.pos + 10)).toBe("## Details");
    expect(result!.flash).toBeNull();
  });

  it("matches headings case-insensitively", () => {
    const result = resolvePendingSection(doc, "dEtAiLs");
    expect(result).not.toBeNull();
    expect(doc.slice(result!.pos, result!.pos + 10)).toBe("## Details");
  });

  it("resolves an anchor section to the line start and flashes the line", () => {
    const result = resolvePendingSection(doc, "^3141e2");
    expect(result).not.toBeNull();
    expect(doc.slice(result!.pos, result!.pos + 5)).toBe("First");
    expect(result!.flash).not.toBeNull();
    expect(doc.slice(result!.flash!.from, result!.flash!.to)).toBe(
      "First block. ^3141e2",
    );
  });

  it("matches anchors case-insensitively", () => {
    const result = resolvePendingSection(doc, "^3141E2");
    expect(result).not.toBeNull();
    expect(doc.slice(result!.pos, result!.pos + 5)).toBe("First");
  });

  it("returns null for a missing heading", () => {
    expect(resolvePendingSection(doc, "Nowhere")).toBeNull();
  });

  it("returns null for a missing anchor", () => {
    expect(resolvePendingSection(doc, "^missing")).toBeNull();
  });
});
