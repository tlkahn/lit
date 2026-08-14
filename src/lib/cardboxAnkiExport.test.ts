import { describe, it, expect, vi } from "vitest";
import type { CardboxAnnotation } from "./ipc";
import { renderMarkdown, renderInlineMarkdown } from "./renderMarkdown";
import {
  buildCardboxAnkiNotes,
  resolveAnkiDeckName,
  ankiModelCss,
} from "./cardboxAnkiExport";

vi.mock("./renderMarkdown", () => ({
  renderMarkdown: vi.fn((text: string) => `<p>${text}</p>`),
  renderInlineMarkdown: vi.fn((text: string) => `<span>${text}</span>`),
}));

function makeCard(overrides: Partial<CardboxAnnotation> = {}): CardboxAnnotation {
  return {
    uuid: "u1",
    annotation_type: "note",
    certainty: "medium",
    body: "body",
    date: null,
    source_page_id: "notes/a.md",
    source_page_title: "Page A",
    source_line: 1,
    char_start: 0,
    char_end: 10,
    scope_kind: "word",
    scope_value: "w",
    original: "quoted",
    ...overrides,
  };
}

describe("buildCardboxAnkiNotes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A1
  it("A1: empty input yields empty notes and no math", () => {
    expect(buildCardboxAnkiNotes([])).toEqual({ notes: [], hasMath: false });
  });

  // A2
  it("A2: body is rendered to markdown html as front_html", () => {
    const card = buildCardboxAnkiNotes([makeCard({ body: "hello" })]).notes[0]!;
    expect(renderMarkdown).toHaveBeenCalledWith("hello");
    expect(card.front_html).toBe("<p>hello</p>");
  });

  // A3
  it("A3: non-empty original renders to back_html via renderInlineMarkdown", () => {
    const card = buildCardboxAnkiNotes([
      makeCard({ original: "quoted text" }),
    ]).notes[0]!;
    expect(renderInlineMarkdown).toHaveBeenCalledWith("quoted text");
    expect(card.back_html).toBe("<span>quoted text</span>");
  });

  // A4
  it("A4a: null original yields empty back_html but still emits a note", () => {
    const result = buildCardboxAnkiNotes([makeCard({ original: null })]);
    expect(result.notes).toHaveLength(1);
    expect(result.notes[0]!.back_html).toBe("");
    expect(renderInlineMarkdown).not.toHaveBeenCalled();
  });

  it("A4b: empty string original yields empty back_html", () => {
    const result = buildCardboxAnkiNotes([makeCard({ original: "" })]);
    expect(result.notes[0]!.back_html).toBe("");
  });

  it("A4c: whitespace-only original yields empty back_html", () => {
    const result = buildCardboxAnkiNotes([makeCard({ original: "   \n " })]);
    expect(result.notes[0]!.back_html).toBe("");
  });

  // A5
  it("A5: preserves input order without sorting", () => {
    const cards = [
      makeCard({ uuid: "z", char_start: 5 }),
      makeCard({ uuid: "a", char_start: 1 }),
      makeCard({ uuid: "m", char_start: 9 }),
    ];
    const { notes } = buildCardboxAnkiNotes(cards);
    expect(notes.map((n) => n.uuid)).toEqual(["z", "a", "m"]);
  });

  // A6
  it("A6: uuid passed through unchanged", () => {
    const { notes } = buildCardboxAnkiNotes([
      makeCard({ uuid: "some-annotation-uuid" }),
    ]);
    expect(notes[0]!.uuid).toBe("some-annotation-uuid");
  });

  // A7
  it("A7: hasMath true when a body renders the cm-preview-math sentinel", () => {
    vi.mocked(renderMarkdown).mockReturnValue('<span class="cm-preview-math-inline">x</span>');
    const { hasMath } = buildCardboxAnkiNotes([makeCard({ body: "$x^2$" })]);
    expect(hasMath).toBe(true);
  });

  // A8
  it("A8: hasMath false for plain text only", () => {
    vi.mocked(renderMarkdown).mockReturnValue("<p>no math</p>");
    vi.mocked(renderInlineMarkdown).mockReturnValue("<span>quote</span>");
    const { hasMath } = buildCardboxAnkiNotes([
      makeCard({ body: "plain", original: "quote" }),
    ]);
    expect(hasMath).toBe(false);
  });

  // B1: empty-front filter (#1026 review)
  it("B1: skips card when body renders to empty front_html", () => {
    vi.mocked(renderMarkdown).mockImplementation((text: string) =>
      text.trim() === "" ? "" : `<p>${text}</p>`,
    );
    const { notes } = buildCardboxAnkiNotes([
      makeCard({ uuid: "empty", body: "" }),
      makeCard({ uuid: "null-body", body: null }),
      makeCard({ uuid: "kept", body: "real" }),
    ]);
    expect(notes.map((n) => n.uuid)).toEqual(["kept"]);
  });

  it("B2: keeps note with empty back when front is non-empty", () => {
    const { notes } = buildCardboxAnkiNotes([
      makeCard({ uuid: "u-front-only", original: null, body: "visible" }),
    ]);
    expect(notes.map((n) => n.uuid)).toEqual(["u-front-only"]);
    expect(notes[0]!.back_html).toBe("");
  });

  it("B3: hasMath ignores cards skipped for empty front", () => {
    vi.mocked(renderMarkdown).mockReturnValue("");
    const { notes, hasMath } = buildCardboxAnkiNotes([
      makeCard({ uuid: "empty-math", body: "$x^2$" }),
    ]);
    expect(notes).toHaveLength(0);
    expect(hasMath).toBe(false);
  });
});

describe("resolveAnkiDeckName", () => {
  // A9
  it("A9a: prefers first card's non-empty source_page_title", () => {
    const cards = [makeCard({ source_page_title: "My Title" })];
    expect(resolveAnkiDeckName(cards, "notes/fallback.md")).toBe("My Title");
  });
  it("A9b: falls back to filename stem when title is blank", () => {
    const cards = [makeCard({ source_page_title: "   " })];
    expect(resolveAnkiDeckName(cards, "notes/deep/page-name.md")).toBe("page-name");
  });

  it("A9c: falls back to stem when no cards", () => {
    expect(resolveAnkiDeckName([], "notes/deep/page-name.md")).toBe("page-name");
  });

  // B4: Anki subdeck separator sanitization (#1026 review)
  it("B4a: replaces :: with space-hyphen-space", () => {
    const cards = [makeCard({ source_page_title: "Foo::Bar" })];
    expect(resolveAnkiDeckName(cards, "notes/x.md")).toBe("Foo - Bar");
  });

  it("B4b: replaces multiple :: occurrences", () => {
    const cards = [makeCard({ source_page_title: "A::B::C" })];
    expect(resolveAnkiDeckName(cards, "notes/x.md")).toBe("A - B - C");
  });

  it("B4c: leaves single colons untouched", () => {
    const cards = [makeCard({ source_page_title: "Note: draft" })];
    expect(resolveAnkiDeckName(cards, "notes/x.md")).toBe("Note: draft");
  });

  it("B4d: sanitizes the stem fallback too", () => {
    const cards = [makeCard({ source_page_title: "" })];
    expect(resolveAnkiDeckName(cards, "notes/Chap::One.md")).toBe("Chap - One");
  });
});

describe("ankiModelCss", () => {
  it("C1: hasMath true returns KaTeX css", () => {
    const css = ankiModelCss(true);
    expect(css).toBeTruthy();
    expect(css).toContain(".katex");
  });

  it("C2: hasMath false returns undefined", () => {
    expect(ankiModelCss(false)).toBeUndefined();
  });
});
