import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CiteprocWidget } from "./citeprocWidget";
import { useWorkspaceStore } from "../../stores/workspace";

function makeView(doc = "test document"): EditorView {
  const state = EditorState.create({ doc });
  return new EditorView({ state, parent: document.createElement("div") });
}

describe("CiteprocWidget", () => {
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
      selectPageAtLine,
    });

    const view = makeView();
    const widget = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "/path/refs.bib", 10);
    const el = widget.toDOM(view);
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(selectPageAtLine).toHaveBeenCalledWith("refs.bib", 10);
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

  it("ignoreEvent returns true", () => {
    const widget = new CiteprocWidget("[@smith2020]", "Smith 2020", true, 0, 13, "refs.bib", 10);
    expect(widget.ignoreEvent()).toBe(true);
  });
});
