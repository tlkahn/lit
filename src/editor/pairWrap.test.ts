import { describe, it, expect, afterEach } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { closeBrackets } from "@codemirror/autocomplete";
import { pairWrapExtension, applyPairWrap, PAIRS } from "./pairWrap";

const views: EditorView[] = [];

function makeView(doc: string, from: number, to: number, extra: import("@codemirror/state").Extension[] = []): EditorView {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.single(from, to),
    extensions: [EditorState.allowMultipleSelections.of(true), pairWrapExtension(), ...extra],
  });
  const view = new EditorView({ state, parent: document.createElement("div") });
  views.push(view);
  return view;
}

/** Drive CM6's inputHandler chain the way real text input does. */
function simulateInput(view: EditorView, text: string): boolean {
  const handlers = view.state.facet(EditorView.inputHandler);
  const { from, to } = view.state.selection.main;
  for (const h of handlers) {
    if (
      h(view, from, to, text, () => {
        const tr = view.state.update(view.state.replaceSelection(text));
        view.dispatch(tr);
        return tr;
      })
    ) {
      return true;
    }
  }
  return false;
}

function getText(view: EditorView): string {
  return view.state.doc.toString();
}

function innerText(view: EditorView): string {
  const sel = view.state.selection.main;
  return view.state.sliceDoc(sel.from, sel.to);
}

afterEach(() => {
  views.forEach((v) => v.destroy());
  views.length = 0;
});

describe("applyPairWrap", () => {
  it.each(Object.entries(PAIRS))("wraps selection with %s ... %s", (open, close) => {
    const view = makeView("hello world", 6, 11);
    const intercepted = simulateInput(view, open);
    expect(intercepted).toBe(true);
    expect(getText(view)).toBe(`hello ${open}world${close}`);
  });

  it("keeps the selection on the inner text after wrapping", () => {
    const view = makeView("hello world", 6, 11);
    simulateInput(view, "(");
    expect(innerText(view)).toBe("world");
    const sel = view.state.selection.main;
    expect(sel.from).toBe(7);
    expect(sel.to).toBe(12);
  });

  it("returns false (does not intercept) on empty selection", () => {
    const view = makeView("hello", 5, 5);
    expect(applyPairWrap(view.state, "(")).toBeNull();
    const intercepted = simulateInput(view, "(");
    expect(intercepted).toBe(false);
  });

  it("supports double-wrapping the still-selected inner text", () => {
    const view = makeView("hello", 0, 5);
    simulateInput(view, "(");
    expect(getText(view)).toBe("(hello)");
    simulateInput(view, "[");
    expect(getText(view)).toBe("([hello])");
    expect(innerText(view)).toBe("hello");
  });

  it("returns false for a non-pair character", () => {
    const view = makeView("hello", 0, 5);
    expect(applyPairWrap(view.state, "a")).toBeNull();
    expect(simulateInput(view, "a")).toBe(false);
  });

  it("returns false for a closing bracket", () => {
    const view = makeView("hello", 0, 5);
    expect(applyPairWrap(view.state, ")")).toBeNull();
    expect(simulateInput(view, ")")).toBe(false);
  });

  it("returns null when the state is read-only", () => {
    const state = EditorState.create({
      doc: "hello",
      selection: EditorSelection.single(0, 5),
      extensions: [EditorState.readOnly.of(true)],
    });
    expect(applyPairWrap(state, "(")).toBeNull();
  });

  it("wraps every range when multiple non-empty selections exist", () => {
    const state = EditorState.create({
      doc: "foo bar",
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.range(4, 7),
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true), pairWrapExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    views.push(view);
    simulateInput(view, "(");
    expect(getText(view)).toBe("(foo) (bar)");
  });

  it("wraps when main selection is empty but secondary has selection", () => {
    const state = EditorState.create({
      doc: "foo bar",
      selection: EditorSelection.create([
        EditorSelection.cursor(0),
        EditorSelection.range(4, 7),
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true), pairWrapExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    views.push(view);
    simulateInput(view, "(");
    expect(getText(view)).toBe("()foo (bar)");
  });

  it("inserts full pair at empty cursor when main selection is non-empty", () => {
    const state = EditorState.create({
      doc: "foo bar",
      selection: EditorSelection.create([
        EditorSelection.range(0, 3),
        EditorSelection.cursor(4),
      ]),
      extensions: [EditorState.allowMultipleSelections.of(true), pairWrapExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    views.push(view);
    simulateInput(view, "(");
    expect(getText(view)).toBe("(foo) ()bar");
  });

  it("preserves a reversed selection (anchor > head)", () => {
    // anchor at 11, head at 6 -> reversed selection over "world".
    const view = makeView("hello world", 11, 6);
    simulateInput(view, "(");
    const sel = view.state.selection.main;
    expect(sel.anchor).toBe(12);
    expect(sel.head).toBe(7);
    expect(innerText(view)).toBe("world");
  });
});

describe("IME / dead-key composition guard", () => {
  it("returns false during an active composition (compositionStarted)", () => {
    const view = makeView("hello world", 6, 11);
    Object.defineProperty(view, "compositionStarted", { value: true, configurable: true });
    const intercepted = simulateInput(view, "`");
    expect(intercepted).toBe(false);
    expect(getText(view)).toBe("hello world");
  });
});

describe("interop with closeBrackets", () => {
  it("intercepts wrapping before closeBrackets when text is selected", () => {
    const view = makeView("hello", 0, 5, [closeBrackets()]);
    const intercepted = simulateInput(view, "(");
    expect(intercepted).toBe(true);
    expect(getText(view)).toBe("(hello)");
  });
});
