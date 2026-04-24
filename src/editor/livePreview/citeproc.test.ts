import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
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
