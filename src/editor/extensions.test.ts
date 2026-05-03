import { describe, it, expect, vi } from "vitest";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { undo } from "@codemirror/commands";
import {
  getSearchQuery,
  openSearchPanel,
  closeSearchPanel,
  setSearchQuery,
  findNext,
  replaceNext,
  replaceAll,
  searchKeymap,
  SearchQuery,
} from "@codemirror/search";
import { createExtensions } from "./extensions";
import { livePreviewPlugin } from "./livePreview/plugin";
import { mediaThumbnailsFacet } from "./livePreview";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

function makeConfig(overrides?: { onChange?: (content: string) => void; editorLocked?: boolean }) {
  return {
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

  it("parses HorizontalRule from ---", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "text\n\n---\n\nmore",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("HorizontalRule");
  });

  it("parses HorizontalRule from ***", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "text\n\n***\n\nmore",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("HorizontalRule");
  });

  it("parses HorizontalRule from ___", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "text\n\n___\n\nmore",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("HorizontalRule");
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

  it("parses InlineComment nodes", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "text %%hidden%% more",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("InlineComment");
  });

  it("mediaThumbnailsFacet defaults to true in created state", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({ doc: "", extensions: exts });
    expect(state.facet(mediaThumbnailsFacet)).toBe(true);
  });

  it("parses BlockComment nodes", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "%%\nblock comment\n%%",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("BlockComment");
  });

  it("editor is editable when editorLocked is false", () => {
    const exts = createExtensions(makeConfig({ editorLocked: false }));
    const state = EditorState.create({ doc: "hello", extensions: exts });
    expect(state.facet(EditorView.editable)).toBe(true);
  });

  it("editor is not editable when editorLocked is true", () => {
    const exts = createExtensions(makeConfig({ editorLocked: true }));
    const state = EditorState.create({ doc: "hello", extensions: exts });
    expect(state.facet(EditorView.editable)).toBe(false);
  });
});

function createViewWithSearch(doc: string, onChange?: (content: string) => void) {
  const exts = createExtensions(makeConfig({ onChange }));
  const state = EditorState.create({ doc, extensions: exts });
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({ state, parent });
  return { view, parent, destroy: () => { view.destroy(); parent.remove(); } };
}

describe("search & replace", () => {
  it("search state field is present", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({ doc: "hello", extensions: exts });
    expect(() => getSearchQuery(state)).not.toThrow();
  });

  it("search panel opens and closes", () => {
    const { view, parent, destroy } = createViewWithSearch("hello world");
    openSearchPanel(view);
    expect(parent.querySelector(".cm-search")).not.toBeNull();
    closeSearchPanel(view);
    expect(parent.querySelector(".cm-search")).toBeNull();
    destroy();
  });

  it("replace triggers onChange", () => {
    const onChange = vi.fn();
    const { view, destroy } = createViewWithSearch("hello world", onChange);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "hello", replace: "goodbye" })) });
    findNext(view);
    replaceNext(view);
    expect(onChange).toHaveBeenCalledWith("goodbye world");
    destroy();
  });

  it("replaceAll triggers onChange with fully replaced content", () => {
    const onChange = vi.fn();
    const { view, destroy } = createViewWithSearch("foo bar foo baz foo", onChange);
    view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "foo", replace: "qux" })) });
    replaceAll(view);
    const calls = onChange.mock.calls;
    expect(calls[calls.length - 1]![0]).toBe("qux bar qux baz qux");
    destroy();
  });

  it("search keybindings don't conflict with list commands", () => {
    const listKeys = new Set(["Enter", "Tab", "Shift-Tab"]);
    const conflicting = searchKeymap.filter((b) => b.key && listKeys.has(b.key));
    expect(conflicting).toHaveLength(0);
  });

  it("search panel renders with themed container", () => {
    const { view, parent, destroy } = createViewWithSearch("hello");
    openSearchPanel(view);
    expect(parent.querySelector(".cm-panels")).not.toBeNull();
    expect(parent.querySelector(".cm-search")).not.toBeNull();
    destroy();
  });
});
