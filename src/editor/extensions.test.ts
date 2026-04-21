import { describe, it, expect, vi } from "vitest";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import { createExtensions } from "./extensions";
import { livePreviewPlugin } from "./livePreview/plugin";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

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

  it("includes livePreviewPlugin", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({ doc: "# Hello", extensions: exts });
    const view = new EditorView({ state, parent: document.createElement("div") });
    expect(view.plugin(livePreviewPlugin)).toBeDefined();
    view.destroy();
  });

  it("parses CodeInfo for fenced code with language", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "```javascript\nconsole.log('hi')\n```",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("CodeInfo");
  });

  it("parses WikiLink nodes", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "See [[Another Page]] here.",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("WikiLink");
    expect(names).toContain("WikiLinkMark");
  });

  it("parses Frontmatter at doc start", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "---\ntitle: Test\n---\n\n# Hello",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("Frontmatter");
    expect(names).not.toContain("HorizontalRule");
  });

  it("parses InlineMath nodes", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "Inline $E=mc^2$ here.",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("InlineMath");
  });

  it("parses DisplayMath nodes", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "$$\nx^2 + y^2 = z^2\n$$",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("DisplayMath");
  });
});
