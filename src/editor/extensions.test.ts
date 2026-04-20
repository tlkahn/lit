import { describe, it, expect, vi } from "vitest";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { createExtensions } from "./extensions";

function makeConfig(overrides?: { onChange?: (content: string) => void }) {
  return {
    theme: "light" as const,
    themeCompartment: new Compartment(),
    highlightCompartment: new Compartment(),
    ...overrides,
  };
}

describe("createExtensions", () => {
  it("returns a valid Extension array", () => {
    const exts = createExtensions(makeConfig());
    expect(() => EditorState.create({ extensions: exts })).not.toThrow();
  });

  it("parses ATXHeading1 in markdown", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({ doc: "# Hello", extensions: exts });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("ATXHeading1");
  });

  it("parses FencedCode in markdown", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "```js\nconsole.log('hi')\n```",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("FencedCode");
  });

  it("parses GFM task lists", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "- [ ] task\n- [x] done",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("Task");
  });

  it("includes history (undo/redo)", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({ doc: "hello", extensions: exts });
    const view = new EditorView({ state, parent: document.createElement("div") });
    view.dispatch({ changes: { from: 5, insert: " world" } });
    expect(view.state.doc.toString()).toBe("hello world");
    undo(view);
    expect(view.state.doc.toString()).toBe("hello");
    view.destroy();
  });

  it("calls onChange when document changes", () => {
    const onChange = vi.fn();
    const exts = createExtensions(makeConfig({ onChange }));
    const state = EditorState.create({ doc: "", extensions: exts });
    const view = new EditorView({ state, parent: document.createElement("div") });
    view.dispatch({ changes: { from: 0, insert: "typed" } });
    expect(onChange).toHaveBeenCalledWith("typed");
    view.destroy();
  });
});
