import { describe, it, expect } from "vitest";
import { TYPE_ICON, certaintyMark, certaintyClass, truncateBody } from "./annotationConstants";
import type { AnnotationType } from "../../lib/ipc";

const ALL_TYPES: AnnotationType[] = [
  "note", "question", "todo", "crossref", "apparatus", "translation", "llm", "bare",
];

describe("annotationConstants", () => {
  it("TYPE_ICON has an entry for every AnnotationType", () => {
    for (const t of ALL_TYPES) {
      expect(TYPE_ICON[t]).toBeDefined();
      expect(TYPE_ICON[t].length).toBeGreaterThan(0);
    }
  });

  it("llm icon is ⚡", () => {
    expect(TYPE_ICON["llm"]).toBe("⚡");
  });

  it("certaintyMark returns ? for tentative", () => {
    expect(certaintyMark("tentative")).toBe("?");
  });

  it("certaintyMark returns ! for firm", () => {
    expect(certaintyMark("firm")).toBe("!");
  });

  it("certaintyMark returns empty for neutral", () => {
    expect(certaintyMark("neutral")).toBe("");
  });

  it("certaintyClass returns correct classes", () => {
    expect(certaintyClass("tentative")).toBe("cm-annotation-tentative");
    expect(certaintyClass("firm")).toBe("cm-annotation-firm");
    expect(certaintyClass("neutral")).toBe("");
  });

  it("truncateBody truncates long text", () => {
    const long = "a".repeat(80);
    expect(truncateBody(long, 60)).toBe("a".repeat(60) + "…");
  });

  it("truncateBody returns empty for null", () => {
    expect(truncateBody(null)).toBe("");
  });
});
