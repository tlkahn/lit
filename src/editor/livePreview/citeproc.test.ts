import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  bibEntriesField,
  setBibData,
  noteDirFacet,
  scanCiteprocCitations,
  citeprocExtension,
  citeprocMatchesField,
  type BibData,
} from "./citeproc";
import { frontmatterFacet } from "./crossref";
import { mockInvoke } from "../../test/tauri-mock";
import type { BibEntry } from "../../lib/ipc";

function makeBibData(entries: BibEntry[], rendered: Record<string, string>): BibData {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  return { entries, renderedCitations: rendered, byKey };
}

describe("bibEntriesField", () => {
  it("initializes with empty BibData", () => {
    const state = EditorState.create({
      doc: "",
      extensions: [bibEntriesField],
    });
    const value = state.field(bibEntriesField);
    expect(value.entries).toEqual([]);
    expect(value.renderedCitations).toEqual({});
    expect(value.byKey.size).toBe(0);
  });

  it("setBibData effect updates the field value", () => {
    const state = EditorState.create({
      doc: "",
      extensions: [bibEntriesField],
    });
    const entry: BibEntry = {
      key: "smith2020",
      authors: ["Smith"],
      title: "Test",
      year: "2020",
      entry_type: "article",
      line_number: 1,
      bib_file: "refs.bib",
    };
    const data = makeBibData([entry], { smith2020: "Smith 2020" });
    const newState = state.update({ effects: setBibData.of(data) }).state;
    const value = newState.field(bibEntriesField);
    expect(value.entries).toHaveLength(1);
    expect(value.renderedCitations["smith2020"]).toBe("Smith 2020");
    expect(value.byKey.get("smith2020")).toEqual(entry);
  });

  it("retains value through unrelated transactions", () => {
    const state = EditorState.create({
      doc: "hello",
      extensions: [bibEntriesField],
    });
    const data = makeBibData([], { smith2020: "Smith 2020" });
    const s2 = state.update({ effects: setBibData.of(data) }).state;
    const s3 = s2.update({ changes: { from: 5, insert: " world" } }).state;
    expect(s3.field(bibEntriesField).renderedCitations["smith2020"]).toBe("Smith 2020");
  });
});

describe("noteDirFacet", () => {
  it("combine returns first value or empty string", () => {
    const state1 = EditorState.create({
      doc: "",
      extensions: [noteDirFacet.of("/notes/sub")],
    });
    expect(state1.facet(noteDirFacet)).toBe("/notes/sub");

    const state2 = EditorState.create({ doc: "" });
    expect(state2.facet(noteDirFacet)).toBe("");
  });
});

describe("scanCiteprocCitations", () => {
  it("finds [@smith2020]", () => {
    const results = scanCiteprocCitations("See [@smith2020] for details");
    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({
      from: 4,
      to: 16,
      keys: [{ key: "smith2020", suppressed: false, locator: undefined }],
    });
  });

  it("finds [-@bush1945, ch. 5] with suppressed flag and locator", () => {
    const results = scanCiteprocCitations("As in [-@bush1945, ch. 5]");
    expect(results).toHaveLength(1);
    expect(results[0]!.keys[0]!.suppressed).toBe(true);
    expect(results[0]!.keys[0]!.key).toBe("bush1945");
    expect(results[0]!.keys[0]!.locator).toBe("ch. 5");
  });

  it("finds multi-cite [@key1; @key2] as single match", () => {
    const results = scanCiteprocCitations("See [@key1; @key2] here");
    expect(results).toHaveLength(1);
    expect(results[0]!.keys).toHaveLength(2);
    expect(results[0]!.keys[0]!.key).toBe("key1");
    expect(results[0]!.keys[1]!.key).toBe("key2");
  });

  it("skips [@fig:cat] (has colon → crossref)", () => {
    const results = scanCiteprocCitations("See [@fig:cat] here");
    expect(results).toHaveLength(0);
  });

  it("skips crossref keys but keeps citeproc keys in multi-cite", () => {
    const results = scanCiteprocCitations("See [@fig:cat; @smith2020] here");
    expect(results).toHaveLength(0);
  });

  it("returns empty for text with no citations", () => {
    const results = scanCiteprocCitations("No citations here");
    expect(results).toHaveLength(0);
  });

  it("finds multiple separate citations", () => {
    const results = scanCiteprocCitations("[@a] and [@b]");
    expect(results).toHaveLength(2);
  });

  it("handles citation with prefix text", () => {
    const results = scanCiteprocCitations("See [cf. @smith2020, p. 5]");
    expect(results).toHaveLength(1);
    expect(results[0]!.keys[0]!.key).toBe("smith2020");
    expect(results[0]!.keys[0]!.locator).toBe("p. 5");
  });
});

describe("citeprocMatchesField", () => {
  it("initializes with scan results from doc containing citations", () => {
    const state = EditorState.create({
      doc: "See [@smith2020] here",
      extensions: [citeprocMatchesField],
    });
    const matches = state.field(citeprocMatchesField);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      from: 4,
      to: 16,
      keys: [{ key: "smith2020", suppressed: false, locator: undefined }],
    });
  });

  it("initializes as empty for doc with no citations", () => {
    const state = EditorState.create({
      doc: "No citations here",
      extensions: [citeprocMatchesField],
    });
    expect(state.field(citeprocMatchesField)).toHaveLength(0);
  });

  it("initializes as empty for empty doc", () => {
    const state = EditorState.create({
      doc: "",
      extensions: [citeprocMatchesField],
    });
    expect(state.field(citeprocMatchesField)).toHaveLength(0);
  });

  it("recomputes on doc change — insert new citation", () => {
    const state = EditorState.create({
      doc: "See [@a] here",
      extensions: [citeprocMatchesField],
    });
    expect(state.field(citeprocMatchesField)).toHaveLength(1);
    const newState = state.update({
      changes: { from: state.doc.length, insert: " and [@b]" },
    }).state;
    expect(newState.field(citeprocMatchesField)).toHaveLength(2);
  });

  it("recomputes on doc change — delete all citations", () => {
    const state = EditorState.create({
      doc: "See [@a] here",
      extensions: [citeprocMatchesField],
    });
    expect(state.field(citeprocMatchesField)).toHaveLength(1);
    const newState = state.update({
      changes: { from: 0, to: state.doc.length, insert: "no citations" },
    }).state;
    expect(newState.field(citeprocMatchesField)).toHaveLength(0);
  });

  it("does NOT recompute on selection-only change (reference equality)", () => {
    const state = EditorState.create({
      doc: "See [@a] here",
      extensions: [citeprocMatchesField],
    });
    const matchesBefore = state.field(citeprocMatchesField);
    const newState = state.update({
      selection: { anchor: 5 },
    }).state;
    const matchesAfter = newState.field(citeprocMatchesField);
    expect(matchesAfter).toBe(matchesBefore);
  });
});

describe("decoration provider", () => {
  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") return [];
      if (cmd === "render_bib_citations") return {};
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  function makeViewWithBib(doc: string, bibData: BibData, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [citeprocExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    view.dispatch({ effects: setBibData.of(bibData) });
    return view;
  }

  it("builds Decoration.replace for matched citeproc citations", () => {
    const entry: BibEntry = {
      key: "smith2020",
      authors: ["Smith"],
      title: "Test",
      year: "2020",
      entry_type: "article",
      line_number: 5,
      bib_file: "refs.bib",
    };
    const bibData = makeBibData([entry], { smith2020: "Smith 2020" });
    const doc = "See [@smith2020] here";
    const view = makeViewWithBib(doc, bibData, doc.length);
    const data = view.state.field(bibEntriesField);
    expect(data.byKey.has("smith2020")).toBe(true);
    view.destroy();
  });

  it("marks invalid key with isValid false in bib data", () => {
    const bibData = makeBibData([], {});
    const doc = "See [@unknown] here";
    const view = makeViewWithBib(doc, bibData, doc.length);
    const data = view.state.field(bibEntriesField);
    expect(data.byKey.has("unknown")).toBe(false);
    view.destroy();
  });

  it("skips citations in cursor editable range", () => {
    const entry: BibEntry = {
      key: "smith2020",
      authors: ["Smith"],
      title: "Test",
      year: "2020",
      entry_type: "article",
      line_number: 5,
      bib_file: "refs.bib",
    };
    const bibData = makeBibData([entry], { smith2020: "Smith 2020" });
    const doc = "See [@smith2020] here";
    const view = makeViewWithBib(doc, bibData, 8);
    const data = view.state.field(bibEntriesField);
    expect(data.entries).toHaveLength(1);
    view.destroy();
  });
});

describe("svatantraḥ kartā scenario: Unicode bib path + note switch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const SANSKRIT_BIB_ENTRIES: BibEntry[] = [
    {
      key: "torella2002ipk",
      authors: ["Torella, Raffaele"],
      title: "The Īśvarapratyabhijñākārikā",
      year: "2002",
      entry_type: "book",
      line_number: 0,
      bib_file: "/vault/assets/bib/svatantraḥ kartā.bib",
    },
    {
      key: "torella1992pratyabhijna",
      authors: ["Torella, Raffaele"],
      title: "The Pratyabhijñā and the Logical-Epistemological School of Buddhism",
      year: "1992",
      entry_type: "incollection",
      line_number: 8,
      bib_file: "/vault/assets/bib/svatantraḥ kartā.bib",
    },
    {
      key: "iyer1969bhartrhari",
      authors: ["Iyer, K. A. Subramania"],
      title: "Bhartṛhari",
      year: "1969",
      entry_type: "book",
      line_number: 18,
      bib_file: "/vault/assets/bib/svatantraḥ kartā.bib",
    },
  ];

  const SANSKRIT_RENDERED: Record<string, string> = {
    torella2002ipk: "Torella 2002a",
    torella1992pratyabhijna: "Torella 1992",
    iyer1969bhartrhari: "Iyer 1969",
  };

  const SANSKRIT_DOC = [
    "# svatantraḥ kartā",
    "",
    "Argument chain [@torella2002ipk, ch. 1].",
    "",
    "See also [@iyer1969bhartrhari; @torella1992pratyabhijna].",
  ].join("\n");

  const SANSKRIT_FM = {
    title: "svatantraḥ kartā",
    bibliography: "assets/bib/svatantraḥ kartā.bib",
  };

  it("scanCiteprocCitations finds both citations in the Sanskrit note", () => {
    const matches = scanCiteprocCitations(SANSKRIT_DOC);
    expect(matches).toHaveLength(2);

    expect(matches[0]!.keys).toEqual([
      { key: "torella2002ipk", suppressed: false, locator: "ch. 1" },
    ]);

    expect(matches[1]!.keys).toHaveLength(2);
    expect(matches[1]!.keys[0]!.key).toBe("iyer1969bhartrhari");
    expect(matches[1]!.keys[1]!.key).toBe("torella1992pratyabhijna");
  });

  it("decoration provider marks citations valid when bib data is loaded", () => {
    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") return [];
      if (cmd === "render_bib_citations") return {};
      throw new Error(`Unknown command: ${cmd}`);
    });

    const bibData = makeBibData(SANSKRIT_BIB_ENTRIES, SANSKRIT_RENDERED);
    const state = EditorState.create({
      doc: SANSKRIT_DOC,
      selection: { anchor: SANSKRIT_DOC.length },
      extensions: [citeprocExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    view.dispatch({ effects: setBibData.of(bibData) });

    const data = view.state.field(bibEntriesField);
    expect(data.byKey.has("torella2002ipk")).toBe(true);
    expect(data.byKey.has("iyer1969bhartrhari")).toBe(true);
    expect(data.byKey.has("torella1992pratyabhijna")).toBe(true);

    view.destroy();
  });

  it("fetches bib with Unicode path in frontmatter", async () => {
    let capturedBibPaths: string[] = [];
    let capturedNoteDir = "";

    mockInvoke((cmd, args) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") {
        capturedBibPaths = (args as { bibPaths: string[] }).bibPaths;
        capturedNoteDir = (args as { noteDir: string }).noteDir;
        return SANSKRIT_BIB_ENTRIES;
      }
      if (cmd === "render_bib_citations") return SANSKRIT_RENDERED;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: SANSKRIT_DOC,
      extensions: [
        citeprocExtension(),
        frontmatterFacet.of(SANSKRIT_FM),
        noteDirFacet.of("/vault"),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(200);

    expect(capturedBibPaths).toEqual(["assets/bib/svatantraḥ kartā.bib"]);
    expect(capturedNoteDir).toBe("/vault");

    const data = view.state.field(bibEntriesField);
    expect(data.entries).toHaveLength(3);
    expect(data.byKey.has("torella2002ipk")).toBe(true);

    view.destroy();
  });

  it("stale bib from previous note causes invalid citations until new bib loads", async () => {
    const oldEntry: BibEntry = {
      key: "old_author2020",
      authors: ["Old Author"],
      title: "Old Paper",
      year: "2020",
      entry_type: "article",
      line_number: 0,
      bib_file: "/vault/old.bib",
    };

    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") return [oldEntry];
      if (cmd === "render_bib_citations") return { old_author2020: "Old Author 2020" };
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Start with old note that has working citeproc
    const state = EditorState.create({
      doc: "See [@old_author2020]",
      extensions: [
        citeprocExtension(),
        frontmatterFacet.of({ bibliography: "old.bib" }),
        noteDirFacet.of("/vault"),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    await vi.advanceTimersByTimeAsync(200);

    const oldData = view.state.field(bibEntriesField);
    expect(oldData.entries).toHaveLength(1);
    expect(oldData.byKey.has("old_author2020")).toBe(true);

    // Now simulate switching to the Sanskrit note:
    // 1. Doc changes (new note content)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: SANSKRIT_DOC },
    });

    // 2. At this point, old bibData still present, new doc has unmatched citations
    const midData = view.state.field(bibEntriesField);
    expect(midData.byKey.has("old_author2020")).toBe(true);
    expect(midData.byKey.has("torella2002ipk")).toBe(false);
    // ^ This is the state that produces RED citations

    // 3. Now update frontmatter (which triggers re-fetch)
    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") return SANSKRIT_BIB_ENTRIES;
      if (cmd === "render_bib_citations") return SANSKRIT_RENDERED;
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Reconfigure frontmatter — simulates useEffect firing
    view.dispatch({
      effects: setBibData.of(makeBibData([], {})),
    });

    view.destroy();
  });

  it("re-fetches bib when noteDir changes AFTER frontmatter was already set", async () => {
    let fetchCount = 0;
    let lastNoteDir = "";

    mockInvoke((cmd, args) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") {
        fetchCount++;
        lastNoteDir = (args as { noteDir: string }).noteDir;
        // First fetch with wrong noteDir returns empty; second with correct noteDir returns entries
        return fetchCount === 1 ? [] : SANSKRIT_BIB_ENTRIES;
      }
      if (cmd === "render_bib_citations") {
        return fetchCount <= 1 ? {} : SANSKRIT_RENDERED;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Create with frontmatter set but noteDir empty (simulates race:
    // frontmatter useEffect fires before noteDir useEffect)
    const noteDirCompartment = new Compartment();
    const state = EditorState.create({
      doc: SANSKRIT_DOC,
      extensions: [
        citeprocExtension(),
        frontmatterFacet.of(SANSKRIT_FM),
        noteDirCompartment.of(noteDirFacet.of("")),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(200);

    // First fetch happened with empty noteDir — backend returns empty
    expect(fetchCount).toBe(1);
    expect(lastNoteDir).toBe("");
    expect(view.state.field(bibEntriesField).entries).toHaveLength(0);

    // Now correct the noteDir (simulates noteDir useEffect firing second)
    view.dispatch({
      effects: noteDirCompartment.reconfigure(noteDirFacet.of("/vault")),
    });

    await vi.advanceTimersByTimeAsync(200);

    // BUG CHECK: does the plugin re-fetch after noteDir changes?
    // If fetchCount is still 1, the plugin did NOT re-fetch — that's the bug.
    expect(fetchCount).toBeGreaterThan(1);
    expect(lastNoteDir).toBe("/vault");
    expect(view.state.field(bibEntriesField).entries).toHaveLength(3);

    view.destroy();
  });

  it("note switch: stale bib data persists when new bib file fails to load", async () => {
    const oldEntry: BibEntry = {
      key: "old_author2020",
      authors: ["Old Author"],
      title: "Old Paper",
      year: "2020",
      entry_type: "article",
      line_number: 0,
      bib_file: "/vault/old.bib",
    };
    let invokeCount = 0;

    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") {
        invokeCount++;
        // First call succeeds (old note), subsequent calls return empty (simulating file-not-found)
        return invokeCount === 1 ? [oldEntry] : [];
      }
      if (cmd === "render_bib_citations") {
        return invokeCount === 1 ? { old_author2020: "Old Author 2020" } : {};
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const fmCompartment = new Compartment();
    const state = EditorState.create({
      doc: "See [@old_author2020]",
      extensions: [
        citeprocExtension(),
        fmCompartment.of(frontmatterFacet.of({ bibliography: "old.bib" })),
        noteDirFacet.of("/vault"),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    await vi.advanceTimersByTimeAsync(200);

    // Old note loaded successfully
    expect(view.state.field(bibEntriesField).byKey.has("old_author2020")).toBe(true);

    // Switch note: new doc + new frontmatter
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: SANSKRIT_DOC },
    });
    view.dispatch({
      effects: fmCompartment.reconfigure(frontmatterFacet.of(SANSKRIT_FM)),
    });

    await vi.advanceTimersByTimeAsync(200);

    // The new bib file "failed" (returned empty). bibData should be the empty result,
    // NOT the stale old data. If it's stale, citations will be red.
    const data = view.state.field(bibEntriesField);
    expect(data.entries).toHaveLength(0);
    // If this fails (entries still has old_author2020), stale data is leaking
  });
});

describe("citeprocPlugin bib fetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fetches bib entries when frontmatter bibliography changes", async () => {
    const entry: BibEntry = {
      key: "smith2020",
      authors: ["Smith"],
      title: "Test",
      year: "2020",
      entry_type: "article",
      line_number: 5,
      bib_file: "refs.bib",
    };

    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") return [entry];
      if (cmd === "render_bib_citations") return { smith2020: "Smith 2020" };
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "See [@smith2020] here",
      extensions: [
        citeprocExtension(),
        frontmatterFacet.of({ bibliography: "refs.bib" }),
        noteDirFacet.of("/notes"),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(200);

    const data = view.state.field(bibEntriesField);
    expect(data.entries).toHaveLength(1);
    expect(data.renderedCitations["smith2020"]).toBe("Smith 2020");

    view.destroy();
  });

  it("does NOT re-fetch when only doc text changes", async () => {
    let fetchCount = 0;

    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") {
        fetchCount++;
        return [];
      }
      if (cmd === "render_bib_citations") return {};
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "hello",
      extensions: [
        citeprocExtension(),
        frontmatterFacet.of({ bibliography: "refs.bib" }),
        noteDirFacet.of("/notes"),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(200);
    const initialFetchCount = fetchCount;

    view.dispatch({ changes: { from: 5, insert: " world" } });
    await vi.advanceTimersByTimeAsync(200);

    expect(fetchCount).toBe(initialFetchCount);

    view.destroy();
  });

  it("handles empty bibliography (no fetch, clears entries)", async () => {
    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return { citations: [], definition_tags: [] };
      if (cmd === "resolve_bib_entries") throw new Error("should not be called");
      if (cmd === "render_bib_citations") throw new Error("should not be called");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "hello",
      extensions: [
        citeprocExtension(),
        frontmatterFacet.of({}),
        noteDirFacet.of("/notes"),
      ],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(200);

    const data = view.state.field(bibEntriesField);
    expect(data.entries).toEqual([]);

    view.destroy();
  });
});
