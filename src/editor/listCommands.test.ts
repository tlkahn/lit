import { describe, it, expect, vi } from "vitest";
import { EditorState, EditorSelection, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createExtensions } from "./extensions";
import { enterInList, indentListItem, outdentListItem } from "./listCommands";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

function makeView(doc: string, cursorPos: number): EditorView {
  const config = {
    theme: "light" as const,
    themeCompartment: new Compartment(),
    keymapCompartment: new Compartment(),
    foldCompartment: new Compartment(),
    crossrefCompartment: new Compartment(),
    noteDirCompartment: new Compartment(),
    annotationCompartment: new Compartment(),
    mediaThumbnailsCompartment: new Compartment(),
    focusModeCompartment: new Compartment(),
    editableCompartment: new Compartment(),
  };
  const state = EditorState.create({
    doc,
    extensions: createExtensions(config),
    selection: EditorSelection.cursor(cursorPos),
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

function endOfLine(doc: string, lineNum: number): number {
  const lines = doc.split("\n");
  let pos = 0;
  for (let i = 0; i < lineNum - 1; i++) {
    pos += lines[i]!.length + 1;
  }
  return pos + lines[lineNum - 1]!.length;
}

describe("indentListItem (Tab)", () => {
  it("indents a bullet list item", () => {
    const doc = "- item";
    const view = makeView(doc, endOfLine(doc, 1));
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("  - item");
    view.destroy();
  });

  it("indents an ordered list item", () => {
    const doc = "1. item";
    const view = makeView(doc, endOfLine(doc, 1));
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("  1. item");
    view.destroy();
  });

  it("indents a nested list item deeper", () => {
    const doc = "- parent\n  - child";
    const view = makeView(doc, endOfLine(doc, 2));
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("- parent\n    - child");
    view.destroy();
  });

  it("inserts spaces outside a list (delegates to insertTab)", () => {
    const doc = "plain text";
    const view = makeView(doc, 5);
    indentListItem(view);
    expect(view.state.doc.toString()).not.toBe("plain text");
    view.destroy();
  });

  it("indents a task list item", () => {
    const doc = "- [ ] task";
    const view = makeView(doc, endOfLine(doc, 1));
    indentListItem(view);
    expect(view.state.doc.toString()).toBe("  - [ ] task");
    view.destroy();
  });
});

describe("outdentListItem (Shift+Tab)", () => {
  it("outdents a nested list item", () => {
    const doc = "- parent\n  - child";
    const view = makeView(doc, endOfLine(doc, 2));
    outdentListItem(view);
    expect(view.state.doc.toString()).toBe("- parent\n- child");
    view.destroy();
  });

  it("returns false for a top-level list item", () => {
    const doc = "- item";
    const view = makeView(doc, endOfLine(doc, 1));
    const result = outdentListItem(view);
    expect(result).toBe(false);
    expect(view.state.doc.toString()).toBe("- item");
    view.destroy();
  });

  it("delegates to indentLess outside a list", () => {
    const doc = "  plain text";
    const view = makeView(doc, 5);
    outdentListItem(view);
    expect(view.state.doc.toString()).not.toBe("  plain text");
    view.destroy();
  });
});

describe("enterInList (Enter)", () => {
  it("outdents an empty nested bullet item", () => {
    const doc = "- parent\n  - ";
    const view = makeView(doc, endOfLine(doc, 2));
    const result = enterInList(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("- parent\n- ");
    view.destroy();
  });

  it("returns false on an empty top-level item (lets built-in handle it)", () => {
    const doc = "- ";
    const view = makeView(doc, 2);
    const result = enterInList(view);
    expect(result).toBe(false);
    view.destroy();
  });

  it("returns false on a non-empty list item (lets built-in continue list)", () => {
    const doc = "- item";
    const view = makeView(doc, endOfLine(doc, 1));
    const result = enterInList(view);
    expect(result).toBe(false);
    view.destroy();
  });

  it("outdents an empty nested task item", () => {
    const doc = "- [ ] parent\n  - [ ] ";
    const view = makeView(doc, endOfLine(doc, 2));
    const result = enterInList(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("- [ ] parent\n- [ ] ");
    view.destroy();
  });

  it("outdents an empty nested ordered list item", () => {
    const doc = "1. parent\n  1. ";
    const view = makeView(doc, endOfLine(doc, 2));
    const result = enterInList(view);
    expect(result).toBe(true);
    expect(view.state.doc.toString()).toBe("1. parent\n1. ");
    view.destroy();
  });
});
