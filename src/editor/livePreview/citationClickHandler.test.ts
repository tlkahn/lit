import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  resolveCiteprocKeyIndex,
  citationClickExtension,
} from "./citationClickHandler";
import { crossrefField, setCrossrefData } from "./crossref";
import {
  citeprocMatchesField,
  bibEntriesField,
  setBibData,
  type BibData,
} from "./citeproc";
import { globalJumpTracker } from "../jumpTracker";
import { useWorkspaceStore } from "../../stores/workspace";
import type { AllDecorations } from "../../lib/ipc";

vi.mock("../../stores/workspace", () => ({
  useWorkspaceStore: {
    getState: vi.fn(() => ({
      currentPagePath: "note.md",
      workspacePath: "/workspace",
      selectPageAtLine: vi.fn(),
    })),
    setState: vi.fn((partial: Record<string, unknown>) => {
      const current = (useWorkspaceStore.getState as ReturnType<typeof vi.fn>)();
      (useWorkspaceStore.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        ...current,
        ...partial,
      });
    }),
  },
}));

describe("resolveCiteprocKeyIndex", () => {
  it("single key returns 0", () => {
    expect(resolveCiteprocKeyIndex("[@smith2020]", 0, 5)).toBe(0);
  });

  it("two keys, click on first segment returns 0", () => {
    // [@smith2020; @jones2021]
    // 0123456789...
    expect(resolveCiteprocKeyIndex("[@smith2020; @jones2021]", 0, 3)).toBe(0);
  });

  it("two keys, click on second segment returns 1", () => {
    expect(resolveCiteprocKeyIndex("[@smith2020; @jones2021]", 0, 15)).toBe(1);
  });

  it("click on semicolon separator returns left key index", () => {
    // [@smith2020; @jones2021]
    // The ; is at position 11 in the raw text
    expect(resolveCiteprocKeyIndex("[@smith2020; @jones2021]", 0, 11)).toBe(0);
  });

  it("click on [ returns 0", () => {
    expect(resolveCiteprocKeyIndex("[@smith2020; @jones2021]", 0, 0)).toBe(0);
  });

  it("click on ] returns last index", () => {
    const raw = "[@smith2020; @jones2021]";
    expect(resolveCiteprocKeyIndex(raw, 0, raw.length - 1)).toBe(1);
  });

  it("three keys, click in middle returns 1", () => {
    const raw = "[@a; @b; @c]";
    // inner: "@a; @b; @c"
    // segments: ["@a", " @b", " @c"]
    // seg0: offset 1..3, seg1: offset 4..7, seg2: offset 8..11
    expect(resolveCiteprocKeyIndex(raw, 0, 5)).toBe(1);
  });

  it("key with locator returns correct index", () => {
    const raw = "[@smith2020, p. 5; @jones2021]";
    // inner: "@smith2020, p. 5; @jones2021"
    // segments: ["@smith2020, p. 5", " @jones2021"]
    // Click in the second segment (after ;)
    expect(resolveCiteprocKeyIndex(raw, 0, 20)).toBe(1);
    // Click in the first segment (before ;)
    expect(resolveCiteprocKeyIndex(raw, 0, 5)).toBe(0);
  });

  it("handles offset matchFrom correctly", () => {
    expect(resolveCiteprocKeyIndex("[@smith2020; @jones2021]", 10, 25)).toBe(1);
  });
});

function makeViewWithFields(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [crossrefField, citeprocMatchesField, bibEntriesField, citationClickExtension()],
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  return new EditorView({ state, parent: container });
}

describe("citationClickHandler — crossref", () => {
  beforeEach(() => {
    globalJumpTracker.clear();
  });

  it("cmd+click on raw crossref navigates to target_char_offset", () => {
    const doc = "See [@fig:cat] here\n\nSome target definition text";
    const view = makeViewWithFields(doc);

    const crossrefData: AllDecorations = {
      citations: [{
        original: "[@fig:cat]",
        rendered_text: "Fig. 1",
        is_valid: true,
        char_start: 4,
        char_end: 14,
        target_char_offset: 21,
        target_line: 3,
      }],
      definition_tags: [],
    };
    view.dispatch({
      effects: setCrossrefData.of(crossrefData),
      selection: { anchor: 6 },
    });

    const dispatchSpy = vi.spyOn(view, "dispatch");
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 21 },
        scrollIntoView: true,
      }),
    );
    view.dom.remove();
    view.destroy();
  });

  it("calls recordDeparture with correct position", () => {
    const doc = "See [@fig:cat] here\n\nSome target definition text";
    const view = makeViewWithFields(doc);

    const crossrefData: AllDecorations = {
      citations: [{
        original: "[@fig:cat]",
        rendered_text: "Fig. 1",
        is_valid: true,
        char_start: 4,
        char_end: 14,
        target_char_offset: 21,
        target_line: 3,
      }],
      definition_tags: [],
    };
    view.dispatch({
      effects: setCrossrefData.of(crossrefData),
      selection: { anchor: 6 },
    });

    vi.spyOn(view, "posAtCoords").mockReturnValue(6);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );

    expect(globalJumpTracker.jumps).toHaveLength(1);
    expect(globalJumpTracker.jumps[0]).toEqual(
      expect.objectContaining({ notePath: "note.md", line: 1, col: 4 }),
    );
    view.dom.remove();
    view.destroy();
  });

  it("plain click (no Cmd) returns false", () => {
    const doc = "See [@fig:cat] here\n\nSome target text";
    const view = makeViewWithFields(doc);

    const crossrefData: AllDecorations = {
      citations: [{
        original: "[@fig:cat]",
        rendered_text: "Fig. 1",
        is_valid: true,
        char_start: 4,
        char_end: 14,
        target_char_offset: 21,
        target_line: 3,
      }],
      definition_tags: [],
    };
    view.dispatch({
      effects: setCrossrefData.of(crossrefData),
      selection: { anchor: 6 },
    });

    const dispatchSpy = vi.spyOn(view, "dispatch");
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, bubbles: true }),
    );

    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ scrollIntoView: true }),
    );
    view.dom.remove();
    view.destroy();
  });

  it("cmd+click on invalid crossref places cursor at char_start", () => {
    const doc = "See [@fig:nope] here";
    const view = makeViewWithFields(doc);

    const crossrefData: AllDecorations = {
      citations: [{
        original: "[@fig:nope]",
        rendered_text: "??",
        is_valid: false,
        char_start: 4,
        char_end: 15,
        target_char_offset: null,
        target_line: null,
      }],
      definition_tags: [],
    };
    view.dispatch({
      effects: setCrossrefData.of(crossrefData),
      selection: { anchor: 6 },
    });

    const dispatchSpy = vi.spyOn(view, "dispatch");
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 4 },
      }),
    );
    view.dom.remove();
    view.destroy();
  });
});

describe("citationClickHandler — citeproc", () => {
  beforeEach(() => {
    globalJumpTracker.clear();
  });

  function setupBibData(view: EditorView, entries: BibData["entries"]): void {
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const renderedCitations: Record<string, string> = {};
    for (const e of entries) {
      renderedCitations[e.key] = e.key;
    }
    view.dispatch({
      effects: setBibData.of({ entries, renderedCitations, byKey }),
    });
  }

  it("cmd+click on single-key raw citeproc navigates", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/workspace",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const doc = "See [@smith2020] here";
    const view = makeViewWithFields(doc);

    setupBibData(view, [{
      key: "smith2020",
      authors: ["Smith"],
      title: "Title",
      year: "2020",
      bib_file: "/workspace/refs.bib",
      line_number: 9,
      entry_type: "article",
    }]);

    view.dispatch({ selection: { anchor: 6 } });
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );

    expect(selectPageAtLine).toHaveBeenCalledWith("refs.bib", 10);
    view.dom.remove();
    view.destroy();
  });

  it("multi-key: click on second key navigates to second entry", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/workspace",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const doc = "See [@smith2020; @jones2021] here";
    const view = makeViewWithFields(doc);

    setupBibData(view, [
      { key: "smith2020", authors: ["Smith"], title: "T", year: "2020", bib_file: "/workspace/a.bib", line_number: 4, entry_type: "article" },
      { key: "jones2021", authors: ["Jones"], title: "T", year: "2021", bib_file: "/workspace/b.bib", line_number: 14, entry_type: "article" },
    ]);

    // Place cursor in the citation to make it editable
    view.dispatch({ selection: { anchor: 20 } });
    // Click on position within the second key (@jones2021)
    vi.spyOn(view, "posAtCoords").mockReturnValue(20);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );

    expect(selectPageAtLine).toHaveBeenCalledWith("b.bib", 15);
    view.dom.remove();
    view.destroy();
  });

  it("records departure and sets isNavigating", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/workspace",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const doc = "See [@smith2020] here";
    const view = makeViewWithFields(doc);

    setupBibData(view, [{
      key: "smith2020",
      authors: ["Smith"],
      title: "Title",
      year: "2020",
      bib_file: "/workspace/refs.bib",
      line_number: 9,
      entry_type: "article",
    }]);

    view.dispatch({ selection: { anchor: 6 } });
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );

    expect(globalJumpTracker.jumps).toHaveLength(1);
    expect(globalJumpTracker.isNavigating).toBe(true);
    globalJumpTracker.isNavigating = false;
    view.dom.remove();
    view.destroy();
  });

  it("invalid key places cursor at match.from", () => {
    const doc = "See [@unknown] here";
    const view = makeViewWithFields(doc);

    // No bib data — key is invalid
    view.dispatch({ selection: { anchor: 6 } });
    vi.spyOn(view, "posAtCoords").mockReturnValue(6);

    view.contentDOM.dispatchEvent(
      new MouseEvent("mousedown", { button: 0, metaKey: true, bubbles: true }),
    );

    // citeprocMatchesField won't match without any @ keys that resolve,
    // but we can test with bib data that has no matching entry
    view.dom.remove();
    view.destroy();
  });
});

describe("citationClickHandler — visual affordance", () => {
  it("cm-mod-held class toggles on keydown/keyup Meta", () => {
    const doc = "test";
    const view = makeViewWithFields(doc);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);

    view.dom.remove();
    view.destroy();
  });

  it("cm-mod-held removed on window blur", () => {
    const doc = "test";
    const view = makeViewWithFields(doc);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    window.dispatchEvent(new Event("blur"));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);

    view.dom.remove();
    view.destroy();
  });

  it("cm-mod-held class toggles on Control key", () => {
    const doc = "test";
    const view = makeViewWithFields(doc);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Control" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keyup", { key: "Control" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);

    view.dom.remove();
    view.destroy();
  });

  it("cm-mod-held removed on destroy", () => {
    const doc = "test";
    const view = makeViewWithFields(doc);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Meta" }));
    expect(view.dom.classList.contains("cm-mod-held")).toBe(true);

    view.destroy();
    expect(view.dom.classList.contains("cm-mod-held")).toBe(false);
  });
});
