import { describe, it, expect } from "vitest";
import { generateDsl, type AnnotationFields } from "./annotationDsl";

function fields(overrides: Partial<AnnotationFields> = {}): AnnotationFields {
  return {
    type: null,
    certainty: "neutral",
    scope: null,
    body: "",
    date: null,
    ...overrides,
  };
}

describe("generateDsl", () => {
  describe("compact form", () => {
    it("bare annotation with just body", () => {
      expect(generateDsl(fields({ body: "compare Vasugupta SpK 1.1" }))).toBe(
        "%%! compare Vasugupta SpK 1.1 %%",
      );
    });

    it("note type with body", () => {
      expect(generateDsl(fields({ type: "note", body: "a note" }))).toBe(
        "%%! n | a note %%",
      );
    });

    it("question tentative with scope and date", () => {
      expect(
        generateDsl(
          fields({
            type: "question",
            certainty: "tentative",
            scope: { kind: "words", value: 2 },
            body: "same sense as TĀ 3.68?",
            date: "2026-03",
          }),
        ),
      ).toBe("%%! q? __ | same sense as TĀ 3.68? @2026-03 %%");
    });

    it("todo firm with anchor scope", () => {
      expect(
        generateDsl(
          fields({
            type: "todo",
            certainty: "firm",
            scope: { kind: "anchor", value: "8th century" },
            body: "Sanderson 2007 handout says 9th c.",
          }),
        ),
      ).toBe('%%! todo! ^"8th century" | Sanderson 2007 handout says 9th c. %%');
    });

    it("crossref with paragraph scope, no body", () => {
      expect(
        generateDsl(
          fields({
            type: "crossref",
            scope: { kind: "paragraph", value: 2 },
          }),
        ),
      ).toBe("%%! cf \\pp %%");
    });

    it("apparatus type", () => {
      expect(
        generateDsl(fields({ type: "apparatus", body: "variant reading in ms. B" })),
      ).toBe("%%! app | variant reading in ms. B %%");
    });

    it("translation type with date", () => {
      expect(
        generateDsl(
          fields({
            type: "translation",
            scope: { kind: "words", value: 1 },
            body: "cf. Tibetan version",
            date: "2026-03",
          }),
        ),
      ).toBe("%%! tr _ | cf. Tibetan version @2026-03 %%");
    });

    it("note firm with page scope", () => {
      expect(
        generateDsl(
          fields({
            type: "note",
            certainty: "firm",
            scope: { kind: "page", value: 1 },
            body: "page-level note",
          }),
        ),
      ).toBe("%%! n! \\f | page-level note %%");
    });

    it("sentence scope defaults omitted (null scope)", () => {
      expect(
        generateDsl(fields({ type: "note", body: "no scope specified" })),
      ).toBe("%%! n | no scope specified %%");
    });

    it("sentence scope explicit", () => {
      expect(
        generateDsl(
          fields({
            type: "note",
            scope: { kind: "sentence", value: 2 },
            body: "two sentences",
          }),
        ),
      ).toBe("%%! n \\ss | two sentences %%");
    });

    it("page scope 3", () => {
      expect(
        generateDsl(
          fields({
            type: "crossref",
            scope: { kind: "page", value: 3 },
          }),
        ),
      ).toBe("%%! cf \\fff %%");
    });

    it("words scope 3", () => {
      expect(
        generateDsl(
          fields({
            type: "note",
            scope: { kind: "words", value: 3 },
            body: "three words",
          }),
        ),
      ).toBe("%%! n ___ | three words %%");
    });

    it("paragraph scope 1", () => {
      expect(
        generateDsl(
          fields({
            type: "note",
            scope: { kind: "paragraph", value: 1 },
            body: "one paragraph",
          }),
        ),
      ).toBe("%%! n \\p | one paragraph %%");
    });

    it("sentence scope 1 explicit is included", () => {
      expect(
        generateDsl(
          fields({
            type: "note",
            scope: { kind: "sentence", value: 1 },
            body: "one sentence",
          }),
        ),
      ).toBe("%%! n \\s | one sentence %%");
    });
  });

  describe("block form", () => {
    it("multiline body produces block", () => {
      expect(
        generateDsl(
          fields({
            type: "note",
            certainty: "firm",
            scope: { kind: "paragraph", value: 1 },
            body: "Lambert's framing maps closely to Tainter's\ncomplexity brake.",
            date: "2026-03-28",
          }),
        ),
      ).toBe(
        "%%!\nn!\n\\p\n@2026-03-28\n---\nLambert's framing maps closely to Tainter's\ncomplexity brake.\n%%",
      );
    });

    it("body >80 chars produces block", () => {
      const longBody =
        "This is a very long annotation body that exceeds the eighty character threshold and should trigger block form output.";
      expect(
        generateDsl(fields({ type: "note", body: longBody })),
      ).toBe(`%%!\nn\n---\n${longBody}\n%%`);
    });

    it("block with anchor scope", () => {
      expect(
        generateDsl(
          fields({
            type: "crossref",
            scope: { kind: "anchor", value: "anuttara" },
            body: "Primary parallels:\n- TĀ 3.68",
            date: "2026-03",
          }),
        ),
      ).toBe('%%!\ncf\n^"anuttara"\n@2026-03\n---\nPrimary parallels:\n- TĀ 3.68\n%%');
    });

    it("empty body stays compact even with header fields", () => {
      expect(
        generateDsl(
          fields({
            type: "todo",
            certainty: "firm",
            scope: { kind: "paragraph", value: 1 },
            body: "",
            date: "2026-03-28",
          }),
        ),
      ).toBe("%%! todo! \\p @2026-03-28 %%");
    });

    it("block bare with multiline body", () => {
      expect(
        generateDsl(fields({ body: "line one\nline two" })),
      ).toBe("%%!\n---\nline one\nline two\n%%");
    });
  });

  describe("certainty markers", () => {
    it("tentative outputs ?", () => {
      expect(
        generateDsl(fields({ type: "note", certainty: "tentative", body: "x" })),
      ).toBe("%%! n? | x %%");
    });

    it("firm outputs !", () => {
      expect(
        generateDsl(fields({ type: "note", certainty: "firm", body: "x" })),
      ).toBe("%%! n! | x %%");
    });

    it("neutral outputs nothing", () => {
      expect(
        generateDsl(fields({ type: "note", certainty: "neutral", body: "x" })),
      ).toBe("%%! n | x %%");
    });
  });

  describe("all types", () => {
    it("note → n", () => {
      expect(generateDsl(fields({ type: "note" }))).toBe("%%! n %%");
    });

    it("question → q", () => {
      expect(generateDsl(fields({ type: "question" }))).toBe("%%! q %%");
    });

    it("todo → todo", () => {
      expect(generateDsl(fields({ type: "todo" }))).toBe("%%! todo %%");
    });

    it("crossref → cf", () => {
      expect(generateDsl(fields({ type: "crossref" }))).toBe("%%! cf %%");
    });

    it("apparatus → app", () => {
      expect(generateDsl(fields({ type: "apparatus" }))).toBe("%%! app %%");
    });

    it("translation → tr", () => {
      expect(generateDsl(fields({ type: "translation" }))).toBe("%%! tr %%");
    });

    it("bare (null) with no body → minimal", () => {
      expect(generateDsl(fields())).toBe("%%!  %%");
    });
  });

  describe("date formatting", () => {
    it("YYYY-MM format", () => {
      expect(
        generateDsl(fields({ type: "note", body: "x", date: "2026-03" })),
      ).toBe("%%! n | x @2026-03 %%");
    });

    it("YYYY-MM-DD format", () => {
      expect(
        generateDsl(fields({ type: "note", body: "x", date: "2026-03-28" })),
      ).toBe("%%! n | x @2026-03-28 %%");
    });

    it("null date omitted", () => {
      expect(generateDsl(fields({ type: "note", body: "x" }))).toBe(
        "%%! n | x %%",
      );
    });
  });

  describe("edge cases", () => {
    it("empty body with type only", () => {
      expect(
        generateDsl(fields({ type: "note", scope: { kind: "words", value: 1 } })),
      ).toBe("%%! n _ %%");
    });

    it("anchor scope with special characters", () => {
      expect(
        generateDsl(
          fields({
            type: "note",
            scope: { kind: "anchor", value: 'a "quoted" phrase' },
            body: "test",
          }),
        ),
      ).toBe('%%! n ^"a \\"quoted\\" phrase" | test %%');
    });

    it("date with no body in compact", () => {
      expect(
        generateDsl(fields({ type: "note", date: "2026-03" })),
      ).toBe("%%! n @2026-03 %%");
    });
  });
});
