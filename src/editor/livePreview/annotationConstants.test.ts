import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TYPE_ICON, certaintyMark, certaintyClass, truncateBody, getMarkIcon, CLS } from "./annotationConstants";
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

describe("CLS constants", () => {
  it("has correct values for fire-button classes", () => {
    expect(CLS.FIRE_BTN).toBe("cm-annotation-fire-btn");
    expect(CLS.FIRE_DISABLED).toBe("cm-annotation-fire-disabled");
    expect(CLS.FIRE_PROXIMITY).toBe("cm-annotation-fire-proximity");
  });

  it("has correct values for pill classes", () => {
    expect(CLS.PILL).toBe("cm-annotation-pill");
    expect(CLS.PILL_MINIMAL).toBe("cm-annotation-pill-minimal");
    expect(CLS.PILL_ICON).toBe("cm-annotation-pill-icon");
    expect(CLS.PILL_BODY).toBe("cm-annotation-pill-body");
  });

  it("has correct values for callout classes", () => {
    expect(CLS.CALLOUT).toBe("cm-annotation-callout");
    expect(CLS.CALLOUT_HEADER).toBe("cm-annotation-callout-header");
    expect(CLS.CALLOUT_LABEL).toBe("cm-annotation-callout-label");
    expect(CLS.CALLOUT_BODY).toBe("cm-annotation-callout-body");
  });

  it("has correct values for marker classes", () => {
    expect(CLS.MARKER).toBe("cm-annotation-marker");
    expect(CLS.MARKER_WRAP).toBe("cm-annotation-marker-wrap");
  });

  it("has correct values for thread classes", () => {
    expect(CLS.THREAD).toBe("cm-thread");
    expect(CLS.THREAD_NAV).toBe("cm-thread-nav");
    expect(CLS.THREAD_NAV_ARROW).toBe("cm-thread-nav-arrow");
    expect(CLS.THREAD_TURN_COUNTER).toBe("cm-thread-turn-counter");
    expect(CLS.THREAD_QUESTION).toBe("cm-thread-question");
    expect(CLS.THREAD_EMPTY).toBe("cm-thread-empty");
    expect(CLS.THREAD_OVERFLOW).toBe("cm-thread-overflow");
    expect(CLS.THREAD_OVERFLOW_MENU).toBe("cm-thread-overflow-menu");
    expect(CLS.THREAD_OVERFLOW_ROW).toBe("cm-thread-overflow-row");
    expect(CLS.THREAD_FOLLOWUP_TRIGGER).toBe("cm-thread-followup-trigger");
    expect(CLS.THREAD_FOLLOWUP_INPUT).toBe("cm-thread-followup-input");
  });

  it("has correct values for shared classes", () => {
    expect(CLS.DATE).toBe("cm-annotation-date");
    expect(CLS.SPINNER).toBe("cm-annotation-spinner");
    expect(CLS.STOP_ICON).toBe("cm-annotation-stop-icon");
    expect(CLS.FOLD_ICON).toBe("cm-annotation-fold-icon");
    expect(CLS.TENTATIVE).toBe("cm-annotation-tentative");
    expect(CLS.FIRM).toBe("cm-annotation-firm");
  });

  it("has correct values for state classes", () => {
    expect(CLS.IS_COLLAPSED).toBe("is-collapsed");
    expect(CLS.IS_OPEN).toBe("is-open");
    expect(CLS.SVG_ICON).toBe("svg-icon");
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
