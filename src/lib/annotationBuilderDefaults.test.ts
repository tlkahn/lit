import { describe, it, expect } from "vitest";
import { isValidBuilderDefaults, BUILDER_SCOPE_KINDS } from "./annotationBuilderDefaults";
import type { AnnotationType, Certainty } from "./ipc";

const ANNOTATION_TYPES: (AnnotationType | null)[] = [
  null, "note", "question", "todo", "crossref", "apparatus", "translation", "llm", "bare",
];
const CERTAINTIES: Certainty[] = ["tentative", "firm", "neutral"];

function makeValid(overrides: Record<string, unknown> = {}) {
  return {
    type: "note",
    certainty: "neutral",
    scopeKind: "none",
    scopeCount: 1,
    asymmetric: false,
    scopeAfter: 1,
    ...overrides,
  };
}

describe("isValidBuilderDefaults", () => {
  it("accepts every AnnotationType variant", () => {
    for (const t of ANNOTATION_TYPES) {
      expect(isValidBuilderDefaults(makeValid({ type: t }))).toBe(true);
    }
  });

  it("accepts every Certainty variant", () => {
    for (const c of CERTAINTIES) {
      expect(isValidBuilderDefaults(makeValid({ certainty: c }))).toBe(true);
    }
  });

  it("accepts every BuilderScopeKind variant", () => {
    for (const k of BUILDER_SCOPE_KINDS) {
      expect(isValidBuilderDefaults(makeValid({ scopeKind: k }))).toBe(true);
    }
  });

  it("rejects null and non-object", () => {
    expect(isValidBuilderDefaults(null)).toBe(false);
    expect(isValidBuilderDefaults(undefined)).toBe(false);
    expect(isValidBuilderDefaults("string")).toBe(false);
    expect(isValidBuilderDefaults(42)).toBe(false);
  });

  it("rejects unknown enum strings", () => {
    expect(isValidBuilderDefaults(makeValid({ type: "bogus" }))).toBe(false);
    expect(isValidBuilderDefaults(makeValid({ certainty: "maybe" }))).toBe(false);
    expect(isValidBuilderDefaults(makeValid({ scopeKind: "chapter" }))).toBe(false);
  });

  it.each([0, -1])("rejects scopeCount of %d", (v) => {
    expect(isValidBuilderDefaults(makeValid({ scopeCount: v }))).toBe(false);
  });

  it("rejects scopeCount of NaN", () => {
    expect(isValidBuilderDefaults(makeValid({ scopeCount: NaN }))).toBe(false);
  });

  it("rejects scopeCount of Infinity", () => {
    expect(isValidBuilderDefaults(makeValid({ scopeCount: Infinity }))).toBe(false);
  });

  it.each([0, -1])("rejects scopeAfter of %d", (v) => {
    expect(isValidBuilderDefaults(makeValid({ scopeAfter: v }))).toBe(false);
  });

  it("rejects scopeAfter of NaN", () => {
    expect(isValidBuilderDefaults(makeValid({ scopeAfter: NaN }))).toBe(false);
  });

  it("rejects scopeAfter of Infinity", () => {
    expect(isValidBuilderDefaults(makeValid({ scopeAfter: Infinity }))).toBe(false);
  });
});
