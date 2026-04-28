import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CiteprocWidget, type CiteprocLinkInfo } from "./citeprocWidget";
import { useWorkspaceStore } from "../../stores/workspace";
import { globalJumpTracker } from "../jumpTracker";

function makeView(doc = "test document"): EditorView {
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent: document.createElement("div") });
}

function singleLink(
  renderedText: string,
  isValid: boolean,
  bibFile?: string,
  lineNumber?: number,
): CiteprocLinkInfo[] {
  return [{ renderedText, isValid, bibFile, lineNumber }];
}

describe("CiteprocWidget", () => {
  beforeEach(() => {
    globalJumpTracker.clear();
  });

  it("eq returns true for identical props", () => {
    const links = singleLink("Smith 2020", true, "refs.bib", 10);
    const a = new CiteprocWidget("[@smith2020]", links, 0, 13);
    const b = new CiteprocWidget("[@smith2020]", links, 0, 13);
    expect(a.eq(b)).toBe(true);
  });

  it("eq returns false when renderedText differs", () => {
    const a = new CiteprocWidget("[@smith2020]", singleLink("Smith 2020", true, "refs.bib", 10), 0, 13);
    const b = new CiteprocWidget("[@smith2020]", singleLink("Jones 2021", true, "refs.bib", 10), 0, 13);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when isValid differs", () => {
    const a = new CiteprocWidget("[@smith2020]", singleLink("Smith 2020", true, "refs.bib", 10), 0, 13);
    const b = new CiteprocWidget("[@smith2020]", singleLink("Smith 2020", false, "refs.bib", 10), 0, 13);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when charStart differs", () => {
    const links = singleLink("Smith 2020", true, "refs.bib", 10);
    const a = new CiteprocWidget("[@smith2020]", links, 0, 13);
    const b = new CiteprocWidget("[@smith2020]", links, 5, 13);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when bibFile differs", () => {
    const a = new CiteprocWidget("[@smith2020]", singleLink("Smith 2020", true, "refs.bib", 10), 0, 13);
    const b = new CiteprocWidget("[@smith2020]", singleLink("Smith 2020", true, "other.bib", 10), 0, 13);
    expect(a.eq(b)).toBe(false);
  });

  it("eq returns false when link count differs", () => {
    const a = new CiteprocWidget("[@a; @b]", [
      { renderedText: "A", isValid: true, bibFile: "a.bib", lineNumber: 1 },
      { renderedText: "B", isValid: true, bibFile: "b.bib", lineNumber: 2 },
    ], 0, 8);
    const b = new CiteprocWidget("[@a; @b]", [
      { renderedText: "A", isValid: true, bibFile: "a.bib", lineNumber: 1 },
    ], 0, 8);
    expect(a.eq(b)).toBe(false);
  });

  it("toDOM creates wrapper span with one .cm-crossref-citeproc-key child for single link", () => {
    const view = makeView();
    const widget = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "refs.bib", 10),
      0, 13,
    );
    const el = widget.toDOM(view);
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toBe("cm-crossref-citeproc");
    expect(el.getAttribute("title")).toBe("[@smith2020]");
    expect(el.dataset.original).toBe("[@smith2020]");
    const keys = el.querySelectorAll(".cm-crossref-citeproc-key");
    expect(keys).toHaveLength(1);
    expect(keys[0]!.textContent).toBe("Smith 2020");
    view.destroy();
  });

  it("toDOM creates two .cm-crossref-citeproc-key children with separator for multi-link", () => {
    const view = makeView();
    const links: CiteprocLinkInfo[] = [
      { renderedText: "Iyer 1969", isValid: true, bibFile: "/path/a.bib", lineNumber: 19 },
      { renderedText: "Torella 1992", isValid: true, bibFile: "/path/b.bib", lineNumber: 9 },
    ];
    const widget = new CiteprocWidget("[@iyer1969bhartrhari; @torella1992pratyabhijna]", links, 0, 47);
    const el = widget.toDOM(view);
    const keys = el.querySelectorAll(".cm-crossref-citeproc-key");
    expect(keys).toHaveLength(2);
    expect(keys[0]!.textContent).toBe("Iyer 1969");
    expect(keys[1]!.textContent).toBe("Torella 1992");
    expect(el.textContent).toBe("Iyer 1969; Torella 1992");
    view.destroy();
  });

  it("toDOM adds invalid class when isValid is false", () => {
    const view = makeView();
    const widget = new CiteprocWidget("[@unknown]", singleLink("??", false), 0, 10);
    const el = widget.toDOM(view);
    expect(el.classList.contains("cm-crossref-citeproc")).toBe(true);
    expect(el.classList.contains("invalid")).toBe(true);
    const key = el.querySelector(".cm-crossref-citeproc-key")!;
    expect(key.classList.contains("invalid")).toBe(true);
    view.destroy();
  });

  it("mixed validity applies invalid class per-key", () => {
    const view = makeView();
    const links: CiteprocLinkInfo[] = [
      { renderedText: "Smith 2020", isValid: true, bibFile: "/path/refs.bib", lineNumber: 5 },
      { renderedText: "@unknown", isValid: false },
    ];
    const widget = new CiteprocWidget("[@smith2020; @unknown]", links, 0, 22);
    const el = widget.toDOM(view);
    expect(el.classList.contains("invalid")).toBe(true);
    const keys = el.querySelectorAll(".cm-crossref-citeproc-key");
    expect(keys[0]!.classList.contains("invalid")).toBe(false);
    expect(keys[1]!.classList.contains("invalid")).toBe(true);
    view.destroy();
  });

  it("click on first key span navigates to first entry", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const view = makeView();
    const links: CiteprocLinkInfo[] = [
      { renderedText: "Iyer 1969", isValid: true, bibFile: "/path/a.bib", lineNumber: 19 },
      { renderedText: "Torella 1992", isValid: true, bibFile: "/path/b.bib", lineNumber: 9 },
    ];
    const widget = new CiteprocWidget("[@a; @b]", links, 0, 8);
    const el = widget.toDOM(view);
    const keys = el.querySelectorAll(".cm-crossref-citeproc-key");
    keys[0]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectPageAtLine).toHaveBeenCalledWith("a.bib", 19);
    view.destroy();
  });

  it("click on second key span navigates to second entry", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const view = makeView();
    const links: CiteprocLinkInfo[] = [
      { renderedText: "Iyer 1969", isValid: true, bibFile: "/path/a.bib", lineNumber: 19 },
      { renderedText: "Torella 1992", isValid: true, bibFile: "/path/b.bib", lineNumber: 9 },
    ];
    const widget = new CiteprocWidget("[@a; @b]", links, 0, 8);
    const el = widget.toDOM(view);
    const keys = el.querySelectorAll(".cm-crossref-citeproc-key");
    keys[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectPageAtLine).toHaveBeenCalledWith("b.bib", 9);
    view.destroy();
  });

  it("click navigates to bib file via selectPageAtLine (single link)", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const view = makeView();
    const widget = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "/path/refs.bib", 10),
      0, 13,
    );
    const el = widget.toDOM(view);
    const key = el.querySelector(".cm-crossref-citeproc-key")!;
    key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
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
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 2 } });
    const widget = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "/path/refs.bib", 10),
      0, 13,
    );
    const el = widget.toDOM(view);
    const key = el.querySelector(".cm-crossref-citeproc-key")!;
    key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(globalJumpTracker.jumps).toHaveLength(1);
    expect(globalJumpTracker.jumps[0]).toEqual(
      expect.objectContaining({ notePath: "note.md", line: 1, col: 0 }),
    );
    view.destroy();
  });

  it("click sets isNavigating before calling selectPageAtLine", () => {
    let isNavigatingAtCall = false;
    const selectPageAtLine = vi.fn(() => {
      isNavigatingAtCall = globalJumpTracker.isNavigating;
    });
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const view = makeView();
    const widget = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "/path/refs.bib", 10),
      0, 13,
    );
    const el = widget.toDOM(view);
    const key = el.querySelector(".cm-crossref-citeproc-key")!;
    key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectPageAtLine).toHaveBeenCalled();
    expect(isNavigatingAtCall).toBe(true);
    globalJumpTracker.isNavigating = false;
    view.destroy();
  });

  it("click on invalid widget places cursor at charStart", () => {
    const view = makeView();
    const dispatchSpy = vi.spyOn(view, "dispatch");
    const widget = new CiteprocWidget("[@unknown]", singleLink("??", false), 5, 15);
    const el = widget.toDOM(view);
    const key = el.querySelector(".cm-crossref-citeproc-key")!;
    key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { anchor: 5 },
      }),
    );
    view.destroy();
  });

  it("estimatedHeight returns > 0", () => {
    const widget = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "refs.bib", 10),
      0, 13,
    );
    expect(widget.estimatedHeight).toBeGreaterThan(0);
  });

  it("updateDOM rebuilds children and rebinds handlers", () => {
    const selectPageAtLine = vi.fn();
    useWorkspaceStore.setState({
      workspacePath: "/path",
      currentPagePath: "note.md",
      selectPageAtLine,
    });

    const view = makeView();
    const a = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "/path/old.bib", 5),
      0, 13,
    );
    const dom = a.toDOM(view);
    const b = new CiteprocWidget(
      "[@jones2021]",
      singleLink("Jones 2021", true, "/path/new.bib", 10),
      0, 13,
    );
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.getAttribute("title")).toBe("[@jones2021]");
    expect(dom.dataset.original).toBe("[@jones2021]");
    const key = dom.querySelector(".cm-crossref-citeproc-key")!;
    expect(key.textContent).toBe("Jones 2021");
    key.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(selectPageAtLine).toHaveBeenCalledWith("new.bib", 10);
    view.destroy();
  });

  it("updateDOM updates validity classes", () => {
    const view = makeView();
    const a = new CiteprocWidget("[@unknown]", singleLink("??", false), 0, 10);
    const dom = a.toDOM(view);
    expect(dom.classList.contains("invalid")).toBe(true);
    const b = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "refs.bib", 10),
      0, 13,
    );
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.classList.contains("invalid")).toBe(false);
    const key = dom.querySelector(".cm-crossref-citeproc-key")!;
    expect(key.classList.contains("invalid")).toBe(false);
    view.destroy();
  });

  it("updateDOM rebuilds multi-link children", () => {
    const view = makeView();
    const a = new CiteprocWidget(
      "[@a]",
      singleLink("A 2020", true, "a.bib", 1),
      0, 5,
    );
    const dom = a.toDOM(view);
    expect(dom.querySelectorAll(".cm-crossref-citeproc-key")).toHaveLength(1);
    const b = new CiteprocWidget("[@a; @b]", [
      { renderedText: "A 2020", isValid: true, bibFile: "a.bib", lineNumber: 1 },
      { renderedText: "B 2021", isValid: true, bibFile: "b.bib", lineNumber: 5 },
    ], 0, 8);
    expect(b.updateDOM(dom, view)).toBe(true);
    expect(dom.querySelectorAll(".cm-crossref-citeproc-key")).toHaveLength(2);
    expect(dom.textContent).toBe("A 2020; B 2021");
    view.destroy();
  });

  it("renderedText getter joins link texts", () => {
    const widget = new CiteprocWidget("[@a; @b]", [
      { renderedText: "A 2020", isValid: true },
      { renderedText: "B 2021", isValid: true },
    ], 0, 8);
    expect(widget.renderedText).toBe("A 2020; B 2021");
  });

  it("isValid getter reflects per-link validity", () => {
    const allValid = new CiteprocWidget("[@a; @b]", [
      { renderedText: "A", isValid: true },
      { renderedText: "B", isValid: true },
    ], 0, 8);
    expect(allValid.isValid).toBe(true);

    const mixed = new CiteprocWidget("[@a; @b]", [
      { renderedText: "A", isValid: true },
      { renderedText: "B", isValid: false },
    ], 0, 8);
    expect(mixed.isValid).toBe(false);
  });

  it("ignoreEvent returns true", () => {
    const widget = new CiteprocWidget(
      "[@smith2020]",
      singleLink("Smith 2020", true, "refs.bib", 10),
      0, 13,
    );
    expect(widget.ignoreEvent()).toBe(true);
  });
});
