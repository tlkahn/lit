import { describe, it, expect } from "vitest";
import { generateDsl, annotationToFields, getEditCursorOffset, type AnnotationFields } from "./annotationDsl";
import type { Annotation } from "./ipc";

function fields(overrides: Partial<AnnotationFields> = {}): AnnotationFields {
  return {
    id: null,
    type: null,
    certainty: "neutral",
    scope: null,
    body: "",
    date: null,
    lang: null,
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
    original: "<!--- n --->",
    ...overrides,
  };
}

describe("generateDsl", () => {
  describe("compact form", () => {
    it("bare annotation with just body", () => {
      expect(generateDsl(fields({ body: "compare Vasugupta SpK 1.1" }))).toBe(
        "<!--- compare Vasugupta SpK 1.1 --->",
      );
    });

    it("note type with body", () => {
      expect(generateDsl(fields({ type: "note", body: "a note" }))).toBe(
        "<!--- n | a note --->",
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
      ).toBe("<!--- q? __ | same sense as TĀ 3.68? @2026-03 --->");
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
      ).toBe('<!--- todo! ^"8th century" | Sanderson 2007 handout says 9th c. --->');
    });

    it("crossref with paragraph scope, no body", () => {
      expect(
        generateDsl(
          fields({
            type: "crossref",
            scope: { kind: "paragraph", value: 2 },
          }),
        ),
      ).toBe("<!--- cf \\pp --->");
    });

    it("apparatus type", () => {
      expect(
        generateDsl(fields({ type: "apparatus", body: "variant reading in ms. B" })),
      ).toBe("<!--- app | variant reading in ms. B --->");
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
      ).toBe("<!--- tr _ | cf. Tibetan version @2026-03 --->");
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
      ).toBe("<!--- n! \\f | page-level note --->");
    });

    it("sentence scope defaults omitted (null scope)", () => {
      expect(
        generateDsl(fields({ type: "note", body: "no scope specified" })),
      ).toBe("<!--- n | no scope specified --->");
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
      ).toBe("<!--- n \\ss | two sentences --->");
    });

    it("page scope 3", () => {
      expect(
        generateDsl(
          fields({
            type: "crossref",
            scope: { kind: "page", value: 3 },
          }),
        ),
      ).toBe("<!--- cf \\fff --->");
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
      ).toBe("<!--- n ___ | three words --->");
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
      ).toBe("<!--- n \\p | one paragraph --->");
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
      ).toBe("<!--- n \\s | one sentence --->");
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
        "<!---\nn!\n\\p\n@2026-03-28\n---\nLambert's framing maps closely to Tainter's\ncomplexity brake.\n--->",
      );
    });

    it("long single-line body stays compact by default", () => {
      const longBody =
        "This is a very long annotation body that exceeds eighty characters but has no newline, so it stays compact.";
      expect(
        generateDsl(fields({ type: "note", body: longBody })),
      ).toBe(`<!--- n | ${longBody} --->`);
    });

    it("explicit block form with short body produces block", () => {
      expect(
        generateDsl(fields({ type: "note", body: "short" }), { form: "block" }),
      ).toBe("<!---\nn\n---\nshort\n--->");
    });

    it("explicit inline form is overridden to block by a newline body", () => {
      expect(
        generateDsl(fields({ type: "note", body: "line one\nline two" }), { form: "inline" }),
      ).toBe("<!---\nn\n---\nline one\nline two\n--->");
    });

    it("newline body defaults to block without explicit form", () => {
      expect(
        generateDsl(fields({ type: "note", body: "line one\nline two" })),
      ).toBe("<!---\nn\n---\nline one\nline two\n--->");
    });

    it("explicit inline form with short body stays compact", () => {
      expect(
        generateDsl(fields({ type: "note", body: "short" }), { form: "inline" }),
      ).toBe("<!--- n | short --->");
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
      ).toBe('<!---\ncf\n^"anuttara"\n@2026-03\n---\nPrimary parallels:\n- TĀ 3.68\n--->');
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
      ).toBe("<!--- todo! \\p @2026-03-28 --->");
    });

    it("block bare with multiline body", () => {
      expect(
        generateDsl(fields({ body: "line one\nline two" })),
      ).toBe("<!---\n---\nline one\nline two\n--->");
    });
  });

  describe("certainty markers", () => {
    it("tentative outputs ?", () => {
      expect(
        generateDsl(fields({ type: "note", certainty: "tentative", body: "x" })),
      ).toBe("<!--- n? | x --->");
    });

    it("firm outputs !", () => {
      expect(
        generateDsl(fields({ type: "note", certainty: "firm", body: "x" })),
      ).toBe("<!--- n! | x --->");
    });

    it("neutral outputs nothing", () => {
      expect(
        generateDsl(fields({ type: "note", certainty: "neutral", body: "x" })),
      ).toBe("<!--- n | x --->");
    });
  });

  describe("all types", () => {
    it("note → n", () => {
      expect(generateDsl(fields({ type: "note" }))).toBe("<!--- n --->");
    });

    it("question → q", () => {
      expect(generateDsl(fields({ type: "question" }))).toBe("<!--- q --->");
    });

    it("todo → todo", () => {
      expect(generateDsl(fields({ type: "todo" }))).toBe("<!--- todo --->");
    });

    it("crossref → cf", () => {
      expect(generateDsl(fields({ type: "crossref" }))).toBe("<!--- cf --->");
    });

    it("apparatus → app", () => {
      expect(generateDsl(fields({ type: "apparatus" }))).toBe("<!--- app --->");
    });

    it("translation → tr", () => {
      expect(generateDsl(fields({ type: "translation" }))).toBe("<!--- tr --->");
    });

    it("thread → th", () => {
      expect(generateDsl(fields({ type: "thread" }))).toBe("<!--- th --->");
    });

    it("slipnote → sn", () => {
      expect(generateDsl(fields({ type: "slipnote" }))).toBe("<!--- sn --->");
    });

    it("slipnote with anchor scope and body", () => {
      const dsl = generateDsl(fields({
        type: "slipnote",
        scope: { kind: "anchor", value: "p" },
        body: "x",
      }));
      expect(dsl).toContain("sn");
      expect(dsl).toContain('^"p"');
    });

    it("bare (null) with no body → minimal", () => {
      expect(generateDsl(fields())).toBe("<!---  --->");
    });
  });

  describe("mark type", () => {
    it("nb mark with words scope", () => {
      expect(
        generateDsl(fields({ mark: "nb", scope: { kind: "words", value: 1 } })),
      ).toBe("<!--- nb _ --->");
    });

    it("sic mark with words scope", () => {
      expect(
        generateDsl(fields({ mark: "sic", scope: { kind: "words", value: 1 } })),
      ).toBe("<!--- sic _ --->");
    });

    it("crux mark with no scope", () => {
      expect(generateDsl(fields({ mark: "crux" }))).toBe("<!--- crux --->");
    });

    it("mark combines with certainty marker", () => {
      expect(
        generateDsl(
          fields({ mark: "sic", certainty: "tentative", scope: { kind: "words", value: 1 } }),
        ),
      ).toBe("<!--- sic? _ --->");
    });

    it("mark with id", () => {
      expect(
        generateDsl(fields({ id: "m1", mark: "nb", scope: { kind: "words", value: 1 } })),
      ).toBe("<!---[m1] nb _ --->");
    });

    it("mark takes precedence over a non-null type", () => {
      expect(
        generateDsl(fields({ mark: "nb", type: "note", scope: { kind: "words", value: 1 } })),
      ).toBe("<!--- nb _ --->");
    });
  });

  describe("date formatting", () => {
    it("YYYY-MM format", () => {
      expect(
        generateDsl(fields({ type: "note", body: "x", date: "2026-03" })),
      ).toBe("<!--- n | x @2026-03 --->");
    });

    it("YYYY-MM-DD format", () => {
      expect(
        generateDsl(fields({ type: "note", body: "x", date: "2026-03-28" })),
      ).toBe("<!--- n | x @2026-03-28 --->");
    });

    it("null date omitted", () => {
      expect(generateDsl(fields({ type: "note", body: "x" }))).toBe(
        "<!--- n | x --->",
      );
    });
  });

  describe("edge cases", () => {
    it("empty body with type only", () => {
      expect(
        generateDsl(fields({ type: "note", scope: { kind: "words", value: 1 } })),
      ).toBe("<!--- n _ --->");
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
      ).toBe('<!--- n ^"a \\"quoted\\" phrase" | test --->');
    });

    it("date with no body in compact", () => {
      expect(
        generateDsl(fields({ type: "note", date: "2026-03" })),
      ).toBe("<!--- n @2026-03 --->");
    });
  });
});

describe("getEditCursorOffset", () => {
  it("compact bare body", () => {
    expect(getEditCursorOffset("<!--- body --->")).toBe(6);
  });

  it("compact typed", () => {
    expect(getEditCursorOffset("<!--- n | a note --->")).toBe(6);
  });

  it("compact with scope+date", () => {
    expect(getEditCursorOffset("<!--- q? __ | x @2026-03 --->")).toBe(6);
  });

  it("block with type+body", () => {
    expect(getEditCursorOffset("<!---\nn\n---\nbody\n--->")).toBe(12);
  });

  it("block full headers", () => {
    expect(getEditCursorOffset("<!---\nn!\n\\p\n@2026-03\n---\nbody\n--->")).toBe(25);
  });

  it("block bare body", () => {
    expect(getEditCursorOffset("<!---\n---\nline one\nline two\n--->")).toBe(10);
  });

  it("compact with [my-id]", () => {
    // <!---[my-id] n | hello --->
    // closeBracket = 11, cursor at 13
    expect(getEditCursorOffset("<!---[my-id] n | hello --->")).toBe(13);
  });

  it("block with [my-id]", () => {
    const dsl = "<!---[my-id]\nn\n---\nbody\n--->";
    const separatorIdx = dsl.indexOf("\n---\n");
    expect(getEditCursorOffset(dsl)).toBe(separatorIdx + 5);
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

  it("slipnote annotation_type passes through", () => {
    const f = annotationToFields(makeAnnotation({ annotation_type: "slipnote" }));
    expect(f.type).toBe("slipnote");
  });

  it("slipnote annotationToFields + generateDsl round-trip preserves sn keyword", () => {
    const ann = makeAnnotation({
      annotation_type: "slipnote",
      scope: { kind: "anchor", value: "parent-uuid" },
      body: "Compare with Braudel",
      date: "2026-07-28",
      original: '<!--- sn ^"parent-uuid" | Compare with Braudel @2026-07-28 --->',
    });
    const dsl = generateDsl(annotationToFields(ann));
    expect(dsl).toContain("sn");
    expect(dsl).toContain('^"parent-uuid"');
    expect(dsl).toContain("Compare with Braudel");
  });

  describe("mark mapping", () => {
    it("mark annotation_type sets mark and forces type null", () => {
      const f = annotationToFields(
        makeAnnotation({ annotation_type: "mark", mark: "nb", original: "<!--- nb _ --->" }),
      );
      expect(f.mark).toBe("nb");
      expect(f.type).toBeNull();
    });

    it("non-mark annotation has no mark", () => {
      const f = annotationToFields(makeAnnotation({ annotation_type: "note" }));
      expect(f.mark).toBeFalsy();
    });
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
        original: "<!--- n __ | body --->",
      }));
      expect(f.scope).toEqual({ kind: "words", value: 2 });
    });

    it("paragraph scope passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "paragraph", value: 1 },
        original: "<!--- n \\p | body --->",
      }));
      expect(f.scope).toEqual({ kind: "paragraph", value: 1 });
    });

    it("page scope passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "page", value: 1 },
        original: "<!--- n \\f | body --->",
      }));
      expect(f.scope).toEqual({ kind: "page", value: 1 });
    });

    it("anchor scope passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "anchor", value: "some text" },
        original: '<!--- n ^"some text" | body --->',
      }));
      expect(f.scope).toEqual({ kind: "anchor", value: "some text" });
    });

    it("sentence(1) without explicit scope in original → null", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: "<!--- n | body --->",
      }));
      expect(f.scope).toBeNull();
    });

    it("sentence(1) with explicit \\s in original → passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: "<!--- n \\s | body --->",
      }));
      expect(f.scope).toEqual({ kind: "sentence", value: 1 });
    });

    it("sentence(2) always passes through", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 2 },
        original: "<!--- n \\ss | body --->",
      }));
      expect(f.scope).toEqual({ kind: "sentence", value: 2 });
    });

    it("sentence(1) with _ in original → passes through (words detected)", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: "<!--- n _ | body --->",
      }));
      expect(f.scope).toEqual({ kind: "sentence", value: 1 });
    });

    it("sentence(1) with ^\" in body but no scope marker → null", () => {
      const f = annotationToFields(makeAnnotation({
        scope: { kind: "sentence", value: 1 },
        original: '<!--- n | see ^"foo" --->',
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

  describe("uuid mapping", () => {
    it("user-authored [id] in original → id preserved", () => {
      const f = annotationToFields(makeAnnotation({
        uuid: "my-id",
        original: "<!---[my-id] n | body --->",
      }));
      expect(f.id).toBe("my-id");
    });

    it("user-authored [id] with legacy %%! delimiter → id preserved", () => {
      const f = annotationToFields(makeAnnotation({
        uuid: "my-id",
        original: "%%![my-id] n | body %%",
      }));
      expect(f.id).toBe("my-id");
    });

    it("auto-generated uuid without [id] bracket in original → id null", () => {
      const f = annotationToFields(makeAnnotation({
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        original: "<!--- n | body --->",
      }));
      expect(f.id).toBeNull();
    });

    it("uuid: null → id: null", () => {
      const f = annotationToFields(makeAnnotation({ uuid: null }));
      expect(f.id).toBeNull();
    });

    it("uuid: undefined → id: null", () => {
      const f = annotationToFields(makeAnnotation({ uuid: undefined }));
      expect(f.id).toBeNull();
    });

    it("user-authored [id] on separate line in block form → id preserved", () => {
      const f = annotationToFields(makeAnnotation({
        uuid: "my-id",
        original: "<!---\n[my-id]\nn!\n--->",
      }));
      expect(f.id).toBe("my-id");
    });

    it("user-authored [id] on separate line in legacy block form → id preserved", () => {
      const f = annotationToFields(makeAnnotation({
        uuid: "my-id",
        original: "%%!\n[my-id]\nn!\n%%",
      }));
      expect(f.id).toBe("my-id");
    });

    it("block-form without [id] bracket and auto-generated uuid → id null", () => {
      const f = annotationToFields(makeAnnotation({
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        original: "<!---\nn!\n\\p\n---\nBody.\n--->",
      }));
      expect(f.id).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("note with body round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "note",
        scope: { kind: "sentence", value: 1 },
        body: "a note",
        original: "<!--- n | a note --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!--- n | a note --->");
    });

    it("question tentative with words scope round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "question",
        certainty: "tentative",
        scope: { kind: "words", value: 2 },
        body: "same sense?",
        date: "2026-03",
        original: "<!--- q? __ | same sense? @2026-03 --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!--- q? __ | same sense? @2026-03 --->");
    });

    it("bare annotation with just body round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "bare",
        scope: { kind: "sentence", value: 1 },
        body: "compare Vasugupta",
        original: "<!--- compare Vasugupta --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!--- compare Vasugupta --->");
    });

    it("note with explicit \\s scope round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "note",
        scope: { kind: "sentence", value: 1 },
        body: "one sentence",
        original: "<!--- n \\s | one sentence --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!--- n \\s | one sentence --->");
    });

    it("nb mark round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "mark",
        mark: "nb",
        scope: { kind: "words", value: 1 },
        original: "<!--- nb _ --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!--- nb _ --->");
    });

    it("sic mark round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "mark",
        mark: "sic",
        scope: { kind: "words", value: 1 },
        original: "<!--- sic _ --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!--- sic _ --->");
    });

    it("crux mark round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "mark",
        mark: "crux",
        scope: { kind: "sentence", value: 1 },
        original: "<!--- crux --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!--- crux --->");
    });

    it("annotation with uuid round-trips", () => {
      const ann = makeAnnotation({
        annotation_type: "note",
        scope: { kind: "sentence", value: 1 },
        body: "a note",
        uuid: "my-note-1",
        original: "<!---[my-note-1] n | a note --->",
      });
      expect(generateDsl(annotationToFields(ann))).toBe("<!---[my-note-1] n | a note --->");
    });
  });

  describe("llm type", () => {
    it("generates llm compact form", () => {
      expect(generateDsl(fields({ type: "llm", body: "explain" }))).toBe(
        "<!--- llm | explain --->",
      );
    });

    it("generates llm with scope", () => {
      expect(
        generateDsl(fields({ type: "llm", scope: { kind: "paragraph", value: 1 }, body: "summarize" })),
      ).toBe("<!--- llm \\p | summarize --->");
    });

    it("generates llm block form for multiline body", () => {
      const result = generateDsl(fields({ type: "llm", body: "line1\nline2" }));
      expect(result).toBe("<!---\nllm\n---\nline1\nline2\n--->");
    });
  });

  describe("new scope serialization", () => {
    it("document scope serializes as \\d", () => {
      expect(
        generateDsl(fields({ type: "llm", scope: { kind: "document", value: 0 }, body: "summarize all" })),
      ).toBe("<!--- llm \\d | summarize all --->");
    });

    it("section scope serializes as \\h", () => {
      expect(
        generateDsl(fields({ type: "note", scope: { kind: "section", value: 0 }, body: "review" })),
      ).toBe("<!--- n \\h | review --->");
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
      ).toBe("<!--- llm 2\\s3 | context --->");
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
      ).toBe("<!--- llm 1\\p2 | test --->");
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
      ).toBe("<!--- llm 3_1 | test --->");
    });
  });

  describe("[id] support", () => {
    it("compact with id", () => {
      expect(
        generateDsl(fields({ id: "my-note", type: "note", body: "hello" })),
      ).toBe("<!---[my-note] n | hello --->");
    });

    it("UUID format id", () => {
      expect(
        generateDsl(fields({ id: "550e8400-e29b-41d4-a716-446655440000", type: "note", body: "x" })),
      ).toBe("<!---[550e8400-e29b-41d4-a716-446655440000] n | x --->");
    });

    it("null id produces no bracket", () => {
      expect(
        generateDsl(fields({ id: null, type: "note", body: "x" })),
      ).toBe("<!--- n | x --->");
    });

    it("bare annotation with id", () => {
      expect(
        generateDsl(fields({ id: "ref-1", body: "compare Vasugupta" })),
      ).toBe("<!---[ref-1] compare Vasugupta --->");
    });

    it("full annotation with id", () => {
      expect(
        generateDsl(
          fields({
            id: "ann-42",
            type: "question",
            certainty: "tentative",
            scope: { kind: "words", value: 2 },
            body: "same sense?",
            date: "2026-03",
          }),
        ),
      ).toBe("<!---[ann-42] q? __ | same sense? @2026-03 --->");
    });

    it("block with id", () => {
      expect(
        generateDsl(
          fields({
            id: "block-1",
            type: "note",
            body: "line one\nline two",
          }),
        ),
      ).toBe("<!---[block-1]\nn\n---\nline one\nline two\n--->");
    });

    it("block without id (unchanged)", () => {
      expect(
        generateDsl(
          fields({
            id: null,
            type: "note",
            body: "line one\nline two",
          }),
        ),
      ).toBe("<!---\nn\n---\nline one\nline two\n--->");
    });
  });
});

describe("lang field", () => {
  it("compact form emits lang= after the scope token", () => {
    expect(
      generateDsl(
        fields({
          type: "note",
          certainty: "tentative",
          scope: { kind: "sentence", value: 2 },
          lang: "fr",
          body: "même sens ?",
          date: "2026-07",
        }),
      ),
    ).toBe("<!--- n? \\ss lang=fr | même sens ? @2026-07 --->");
  });

  it("compact form emits lang= with no scope and no body", () => {
    expect(generateDsl(fields({ type: "translation", lang: "ja" }))).toBe(
      "<!--- tr lang=ja --->",
    );
  });

  it("block form emits a lang: header line after the scope", () => {
    expect(
      generateDsl(
        fields({
          type: "note",
          certainty: "firm",
          scope: { kind: "paragraph", value: 1 },
          lang: "fr",
          date: "2026-03-28",
          body: "Le corps.",
        }),
        { form: "block" },
      ),
    ).toBe("<!---\nn!\n\\p\nlang: fr\n@2026-03-28\n---\nLe corps.\n--->");
  });

  it("emits nothing for an empty or null lang (inherit)", () => {
    expect(generateDsl(fields({ type: "note", lang: null, body: "a note" }))).toBe(
      "<!--- n | a note --->",
    );
    expect(generateDsl(fields({ type: "note", lang: "", body: "a note" }))).toBe(
      "<!--- n | a note --->",
    );
    expect(
      generateDsl(fields({ type: "note", lang: null, body: "line one\nline two" })),
    ).toBe("<!---\nn\n---\nline one\nline two\n--->");
  });

  it("annotationToFields reads the annotation's lang", () => {
    expect(annotationToFields(makeAnnotation({ lang: "fr" })).lang).toBe("fr");
    expect(annotationToFields(makeAnnotation()).lang).toBeNull();
    expect(annotationToFields(makeAnnotation({ lang: null })).lang).toBeNull();
  });

  it("round-trips an annotation carrying a lang back to the same DSL", () => {
    const ann = makeAnnotation({
      annotation_type: "note",
      scope: { kind: "sentence", value: 1 },
      lang: "fr",
      body: "une note",
      original: "<!--- n \\s lang=fr | une note --->",
    });
    expect(generateDsl(annotationToFields(ann))).toBe(
      "<!--- n \\s lang=fr | une note --->",
    );
  });

  it("normalizes lang in compact emit (FR-CA -> fr)", () => {
    expect(
      generateDsl(fields({ type: "note", lang: "FR-CA", body: "hello" })),
    ).toBe("<!--- n lang=fr | hello --->");
  });

  it("normalizes lang in block emit (FR-CA -> fr)", () => {
    expect(
      generateDsl(fields({ type: "note", lang: "FR-CA", body: "line\ntwo" })),
    ).toBe("<!---\nn\nlang: fr\n---\nline\ntwo\n--->");
  });

  it("omits unnormalizable lang (english -> nothing)", () => {
    expect(
      generateDsl(fields({ type: "note", lang: "english", body: "hello" })),
    ).toBe("<!--- n | hello --->");
  });
});
