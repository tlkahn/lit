import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { createAnnotationInputHandler } from "./annotationInputHandler";

const views: EditorView[] = [];

function makeView(doc: string, cursorPos?: number): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: GFM }), createAnnotationInputHandler()],
    selection: { anchor: cursorPos ?? doc.length },
  });
  const view = new EditorView({ state });
  views.push(view);
  return view;
}

function simulateInput(view: EditorView, text: string): boolean {
  const handlers = view.state.facet(EditorView.inputHandler);
  const { from, to } = view.state.selection.main;
  for (const h of handlers) {
    if (h(view, from, to, text, () => {
      const tr = view.state.update(view.state.replaceSelection(text));
      view.dispatch(tr);
      return tr;
    })) {
      return true;
    }
  }
  return false;
}

describe("createAnnotationInputHandler", () => {
  let dispatchedEvents: CustomEvent[];
  let listener: (e: Event) => void;

  beforeEach(() => {
    dispatchedEvents = [];
    listener = (e: Event) => dispatchedEvents.push(e as CustomEvent);
    window.addEventListener("lit:open-annotation-builder", listener);
  });

  afterEach(() => {
    window.removeEventListener("lit:open-annotation-builder", listener);
    views.forEach((v) => v.destroy());
    views.length = 0;
  });

  it("extension is valid and can be used in EditorState", () => {
    expect(() => {
      EditorState.create({
        doc: "",
        extensions: [createAnnotationInputHandler()],
      });
    }).not.toThrow();
  });

  it("typing ! after %% returns true and deletes the %%", () => {
    const view = makeView("hello %%", 8);
    const intercepted = simulateInput(view, "!");
    expect(intercepted).toBe(true);
    expect(view.state.doc.toString()).toBe("hello ");
  });

  it("typing ! without preceding %% returns false", () => {
    const view = makeView("hello ", 6);
    const intercepted = simulateInput(view, "!");
    expect(intercepted).toBe(false);
  });

  it("typing ! after single % does not trigger", () => {
    const view = makeView("hello %", 7);
    const intercepted = simulateInput(view, "!");
    expect(intercepted).toBe(false);
  });

  it("typing ! after %% inside a fenced code block does not trigger", () => {
    const doc = "```\nhello %%\n```";
    const cursorPos = 12;
    const view = makeView(doc, cursorPos);
    const intercepted = simulateInput(view, "!");
    expect(intercepted).toBe(false);
  });

  it("multi-char input (paste) containing %%! does not trigger", () => {
    const view = makeView("hello ", 6);
    const intercepted = simulateInput(view, "%%!");
    expect(intercepted).toBe(false);
  });

  it("dispatches lit:open-annotation-builder event on trigger", () => {
    const view = makeView("hello %%", 8);
    simulateInput(view, "!");
    expect(dispatchedEvents).toHaveLength(1);
    expect(dispatchedEvents[0]!.type).toBe("lit:open-annotation-builder");
  });
});
