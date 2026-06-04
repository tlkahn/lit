import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TYPE_ICON, certaintyMark, certaintyClass, truncateBody, getMarkIcon } from "./annotationConstants";
import type { AnnotationType } from "../../lib/ipc";
import { useMarkConfigStore } from "../../stores/markConfig";

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

describe("getMarkIcon", () => {
  beforeEach(() => {
    useMarkConfigStore.setState({ config: {}, loaded: false });
  });

  afterEach(() => {
    useMarkConfigStore.setState({ config: {}, loaded: false });
  });

  it("getMarkIcon returns config icon when present", () => {
    useMarkConfigStore.setState({ config: { nb: { label: "nota bene", icon: "B" } }, loaded: true });
    expect(getMarkIcon("nb")).toBe("B");
  });

  it("getMarkIcon falls back to the code when no def", () => {
    expect(getMarkIcon("zzz")).toBe("zzz");
  });

  it("getMarkIcon falls back to the code when def has null/absent icon", () => {
    useMarkConfigStore.setState({ config: { crux: { label: "crux", icon: null } }, loaded: true });
    expect(getMarkIcon("crux")).toBe("crux");
  });
});
