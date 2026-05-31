import { describe, it, expect } from "vitest";
import { generateDsl, annotationToFields, getEditCursorOffset, type AnnotationFields } from "./annotationDsl";
import type { Annotation } from "./ipc";

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

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    form: "compact",
    annotation_type: "note",
    certainty: "neutral",
    scope: { kind: "sentence", value: 1 },
    body: null,
    date: null,
    is_structured: true,
    char_start: 0,
    char_end: 10,
    original: "%%! n %%",
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

describe("getEditCursorOffset", () => {
  it("compact bare body", () => {
    expect(getEditCursorOffset("%%! body %%")).toBe(4);
  });

  it("compact typed", () => {
    expect(getEditCursorOffset("%%! n | a note %%")).toBe(4);
  });

  it("compact with scope+date", () => {
    expect(getEditCursorOffset("%%! q? __ | x @2026-03 %%")).toBe(4);
  });

  it("block with type+body", () => {
    expect(getEditCursorOffset("%%!\nn\n---\nbody\n%%")).toBe(10);
  });

  it("block full headers", () => {
    expect(getEditCursorOffset("%%!\nn!\n\\p\n@2026-03\n---\nbody\n%%")).toBe(23);
  });

  it("block bare body", () => {
    expect(getEditCursorOffset("%%!\n---\nline one\nline two\n%%")).toBe(8);
  });
});

describe("annotationToFields", () => {
  it("bare annotation_type maps to null", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "bare" }));
    expect(f.type).toBeNull();
  });

  it("note annotation_type passes through", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "note" }));
    expect(f.type).toBe("note");
  });

  it("question annotation_type passes through", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "question" }));
    expect(f.type).toBe("question");
  });

  it("todo annotation_type passes through", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "todo" }));
    expect(f.type).toBe("todo");
  });

  it("crossref annotation_type passes through", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "crossref" }));
    expect(f.type).toBe("crossref");
  });

  it("apparatus annotation_type passes through", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "apparatus" }));
    expect(f.type).toBe("apparatus");
  });

  it("translation annotation_type passes through", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "translation" }));
    expect(f.type).toBe("translation");
  });

  describe("certainty passthrough", () => {
    it("tentative", () => {
      const f = annotationToFields(makeAnnotation({ certainty: "tentative" }));
      expect(f.certainty).toBe("tentative");
    });

    it("firm", () => {
      const f = annotationToFields(makeAnnotation({ certainty: "firm" }));
      expect(f.certainty).toBe("firm");
    });

    it("neutral", () => {
      const f = annotationToFields(makeAnnotation({ certainty: "neutral" }));
      expect(f.certainty).toBe("neutral");
    });
  });

  describe("scope mapping", () => {
    it("words scope passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "words", value: 2 },
        original: "%%! n __ | body %%",
      }));
      expect(f.scope).toEqual({ kind: "words", value: 2 });
    });

    it("paragraph scope passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "paragraph", value: 1 },
        original: "%%! n \\p | body %%",
      }));
      expect(f.scope).toEqual({ kind: "paragraph", value: 1 });
    });

    it("page scope passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "page", value: 1 },
        original: "%%! n \\f | body %%",
      }));
      expect(f.scope).toEqual({ kind: "page", value: 1 });
    });

    it("anchor scope passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "anchor", value: "some text" },
        original: '%%! n ^"some text" | body %%',
      }));
      expect(f.scope).toEqual({ kind: "anchor", value: "some text" });
    });

    it("sentence(1) without explicit scope in original → null", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: "%%! n | body %%",
      }));
      expect(f.scope).toBeNull();
    });

    it("sentence(1) with explicit \\s in original → passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: "%%! n \\s | body %%",
      }));
      expect(f.scope).toEqual({ kind: "sentence", value: 1 });
    });

    it("sentence(2) always passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 2 },
        original: "%%! n \\ss | body %%",
      }));
      expect(f.scope).toEqual({ kind: "sentence", value: 2 });
    });

    it("sentence(1) with _ in original → passes through (words detected)", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: "%%! n _ | body %%",
      }));
      expect(f.scope).toEqual({ kind: "sentence", value: 1 });
    });

    it("sentence(1) with ^\" in body but no scope marker → null", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: '%%! n | see ^"foo" %%',
      }));
      expect(f.scope).toBeNull();
    });
  });

  it("body: null → empty string", () => {
    const f = annotationToFields(makeAnnotation({ body: null }));
    expect(f.body).toBe("");
  });

  it("body: 'text' → 'text'", () => {
    const f = annotationToFields(makeAnnotation({ body: "some text" }));
    expect(f.body).toBe("some text");
  });

  it("date passthrough: null stays null", () => {
    const f = annotationToFields(makeAnnotation({ date: null }));
    expect(f.date).toBeNull();
  });

  it("date passthrough: string stays string", () => {
    const f = annotationToFields(makeAnnotation({ date: "2026-03" }));
    expect(f.date).toBe("2026-03");
  });

  describe("round-trip", () => {
    it("note with body round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "note",
        scope: { kind: "sentence", value: 1 },
        body: "a note",
        original: "%%! n | a note %%",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("%%! n | a note %%");
    });

    it("question tentative with words scope round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "question",
        certainty: "tentative",
        scope: { kind: "words", value: 2 },
        body: "same sense?",
        date: "2026-03",
        original: "%%! q? __ | same sense? @2026-03 %%",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("%%! q? __ | same sense? @2026-03 %%");
    });

    it("bare annotation with just body round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "bare",
        scope: { kind: "sentence", value: 1 },
        body: "compare Vasugupta",
        original: "%%! compare Vasugupta %%",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("%%! compare Vasugupta %%");
    });

    it("note with explicit \\s scope round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "note",
        scope: { kind: "sentence", value: 1 },
        body: "one sentence",
        original: "%%! n \\s | one sentence %%",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("%%! n \\s | one sentence %%");
    });
  });

  describe("llm type", () => {
    it("generates llm compact form", () => {
      expect(generateDsl(fields({ type: "llm", body: "explain" }))).toBe(
        "%%! llm | explain %%",
      );
    });

    it("generates llm with scope", () => {
      expect(
        generateDsl(fields({ type: "llm", scope: { kind: "paragraph", value: 1 }, body: "summarize" })),
      ).toBe("%%! llm \\p | summarize %%");
    });

    it("generates llm block form for multiline body", () => {
      const result = generateDsl(fields({ type: "llm", body: "line1\nline2" }));
      expect(result).toBe("%%!\nllm\n---\nline1\nline2\n%%");
    });
  });

  describe("new scope serialization", () => {
    it("document scope serializes as \\d", () => {
      expect(
        generateDsl(fields({ type: "llm", scope: { kind: "document", value: 0 }, body: "summarize all" })),
      ).toBe("%%! llm \\d | summarize all %%");
    });

    it("section scope serializes as \\h", () => {
      expect(
        generateDsl(fields({ type: "note", scope: { kind: "section", value: 0 }, body: "review" })),
      ).toBe("%%! n \\h | review %%");
    });

    it("asymmetric scope serializes with before\\unit after format", () => {
      expect(
        generateDsl(
          fields({
            type: "llm",
            scope: { kind: "asymmetric", value: { unit: "sentence", before: 2, after: 3 } },
            body: "context",
          }),
        ),
      ).toBe("%%! llm 2\\s3 | context %%");
    });

    it("asymmetric scope with paragraph unit", () => {
      expect(
        generateDsl(
          fields({
            type: "llm",
            scope: { kind: "asymmetric", value: { unit: "paragraph", before: 1, after: 2 } },
            body: "test",
          }),
        ),
      ).toBe("%%! llm 1\\p2 | test %%");
    });

    it("asymmetric scope with word unit uses underscore", () => {
      expect(
        generateDsl(
          fields({
            type: "llm",
            scope: { kind: "asymmetric", value: { unit: "word", before: 3, after: 1 } },
            body: "test",
          }),
        ),
      ).toBe("%%! llm 3_1 | test %%");
    });
  });
});
