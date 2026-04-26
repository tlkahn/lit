import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CiteprocWidget } from "./citeprocWidget";
import { useWorkspaceStore } from "../../stores/workspace";
import { globalJumpTracker } from "../jumpTracker";

function makeView(doc = "test document"): EditorView {
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("CiteprocWidget", () => {
  beforeEach(() => {
    globalJumpTracker.clear();
  });

  it("eq returns true for identical props", () => {
    const a = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    const b = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when renderedText differs", () => {
    const a = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    const b = new CiteprocWidget("[@smith2020]", "Jones 2021", true, 0, 13, "refs.bib", 10);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when isValid differs", () => {
    const a = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    const b = new CiteprocWidget("[@smith2020]", "Smith 2020", false, 0, 13, "refs.bib", 10);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when charStart differs", () => {
    const a = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    const b = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 5, 13, "refs.bib", 10);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when bibFile differs", () => {
    const a = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    const b = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "other.bib", 10);
    expect(a.eq(b)).toBe(false);
  });

  it("toDOM creates span with correct class, text, title, data attributes", () => {
    const view = makeView();
    const widget = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    const el = widget.toDOM(view);
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cm-crossref-citeproc");
    expect(el.textContent).toBe("Smith 2020");
    expect(el.getAttribute("title")).toBe("[@smith2020]");
    expect(el.dataset.original).toBe("[@smith2020]");
    view.destroy();
  });

  it("toDOM adds invalid class when isValid is false", () => {
    const view = makeView();
    const widget = new CiteprocWidget("[@unknown]", "??", false, 0, 10);
    const el = widget.toDOM(view);
    expect(el.classList.contains("cm-crossref-citeproc")).toBe(true);
    expect(el.classList.contains("invalid")).toBe(true);
    view.destroy();
  });

  it("click navigates to bib file via selectPageAtLine", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const view = makeView();
    const widget = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "/path/refs.bib", 10);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(selectPageAtLine).toHaveBeenCalledWith("refs.bib", 10);
    view.destroy();
  });

  it("click records departure at link position, not cursor position", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const doc = "line one\nline two\nline three\nline four";
    const view = makeView(doc);
    // Place cursor on line 3
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
    // Widget charStart=0 is on line 1
    const widget = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "/path/refs.bib", 10);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(globalJumpTracker.jumps).toHaveLength(1);
    // Departure should be at charStart (line 1, col 0), not cursor (line 3)
    expect(globalJumpTracker.jumps[0]).toEqual(
      expect.objectContaining({ notePath: "note.md", line: 1, col: 0 }),
    );
    view.destroy();
  });

  it("click on invalid widget places cursor at charStart", () => {
    const view = makeView();
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = new CiteprocWidget("[@unknown]", "??", false, 5, 15);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 5 },
      }),
    );
    view.destroy();
  });

  it("estimatedHeight returns > 0", () => {
    const widget = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    expect(widget.estimatedHeight).toBeGreaterThan(0);
  });

  it("updateDOM updates text, title, data, and validity", () => {
    const view = makeView();
    const a = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    const dom = a.toDOM(view);
    const b = new CiteprocWidget("[@jones2021]", "Jones 2021", false, 5, 18);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.textContent).toBe("Jones 2021");
    expect(dom.getAttribute("title")).toBe("[@jones2021]");
    expect(dom.dataset.original).toBe("[@jones2021]");
    expect(dom.classList.contains("invalid")).toBe(true);
    view.destroy();
  });

  it("updateDOM removes invalid class when becoming valid", () => {
    const view = makeView();
    const a = new CiteprocWidget("[@unknown]", "??", false, 0, 10);
    const dom = a.toDOM(view);
    expect(dom.classList.contains("invalid")).toBe(true);
    const b = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.classList.contains("invalid")).toBe(false);
    view.destroy();
  });

  it("updateDOM rebinds mousedown handler", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const view = makeView();
    const a = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "/path/old.bib", 5);
    const dom = a.toDOM(view);
    const b = new CiteprocWidget("[@jones2021]", "Jones 2021", true, 0, 13, "/path/new.bib", 10);
    b.updateDOM(dom, view);
    dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectPageAtLine).toHaveBeenCalledWith("new.bib", 10);
    view.destroy();
  });

  it("ignoreEvent returns true", () => {
    const widget = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    expect(widget.ignoreEvent()).toBe(true);
  });
});
