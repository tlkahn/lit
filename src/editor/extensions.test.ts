import { describe, it, expect, vi } from "vitest";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { defaultKeymap, historyKeymap, undo } from "@codemirror/commands";
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
  selectNextOccurrence,
} from "@codemirror/search";
import { createExtensions } from "./extensions";
import { livePreviewPlugin } from "./livePreview/plugin";
import { mediaThumbnailsFacet } from "./livePreview";
import { widgetSync } from "./livePreview/widgetSyncAnnotation";
import { _clear, registerHandler, executeCommand } from "../lib/commandRegistry";
import { resolveKeymaps } from "../lib/keymapResolver";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

function makeConfig(overrides?: { onChange?: (content: string) => void; onSelectionChange?: (line: number, col: number) => void; editorLocked?: boolean }) {
  return {
    theme: "light" as const,
    themeCompartment: new Compartment(),
    keymapCompartment: new Compartment(),
    foldCompartment: new Compartment(),
    crossrefCompartment: new Compartment(),
    noteDirCompartment: new Compartment(),
    notePathCompartment: new Compartment(),
    annotationCompartment: new Compartment(),
    imageResolverCompartment: new Compartment(),
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

  it("parses FootnoteRef and FootnoteDef nodes", () => {
    const exts = createExtensions(makeConfig());
    const state = EditorState.create({
      doc: "See [^1] here.\n\n[^1]: Definition text",
      extensions: exts,
    });
    const tree = syntaxTree(state);
    const names: string[] = [];
    tree.iterate({ enter: (node) => { names.push(node.name); } });
    expect(names).toContain("FootnoteRef");
    expect(names).toContain("FootnoteRefMark");
    expect(names).toContain("FootnoteDef");
    expect(names).toContain("FootnoteDefMark");
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

  // Issue #1013: after create-from-+ the editor is focused but empty. Without
  // drawSelection(), CM falls back to the native contenteditable caret, which
  // is often invisible on an empty doc after programmatic focus. theme.ts
  // styles `.cm-cursor`; drawSelection is what actually renders it.
  it("draws a CM caret layer on an empty focused document", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const exts = createExtensions(makeConfig());
    const view = new EditorView({
      state: EditorState.create({ doc: "", extensions: exts }),
      parent,
    });
    view.focus();
    // drawSelection mounts a cursor layer; native-caret fallback has neither.
    const layer = parent.querySelector(".cm-cursorLayer, .cm-cursor");
    expect(layer).not.toBeNull();
    view.destroy();
    parent.remove();
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

  it("selectNextOccurrence selects word at cursor", () => {
    const { view, destroy } = createViewWithSearch("foo bar foo baz");
    view.dispatch({ selection: { anchor: 1 } });
    const handled = selectNextOccurrence(view);
    expect(handled).toBe(true);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);
    expect(view.state.doc.sliceString(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe("foo");
    destroy();
  });

  it("selectNextOccurrence doesn't conflict with list commands", () => {
    const listKeys = new Set(["Enter", "Tab", "Shift-Tab"]);
    const hasConflict = searchKeymap.some((b) => b.key && listKeys.has(b.key));
    expect(hasConflict).toBe(false);
  });

  it("repeated selectNextOccurrence builds multi-selection", () => {
    const { view, destroy } = createViewWithSearch("foo bar foo baz");
    view.dispatch({ selection: { anchor: 1 } });
    selectNextOccurrence(view);
    selectNextOccurrence(view);
    expect(view.state.selection.ranges.length).toBe(2);
    expect(view.state.selection.ranges[0]!.from).toBe(0);
    expect(view.state.selection.ranges[0]!.to).toBe(3);
    expect(view.state.selection.ranges[1]!.from).toBe(8);
    expect(view.state.selection.ranges[1]!.to).toBe(11);
    destroy();
  });

  it("repeated selectNextOccurrence across lines selects all occurrences", () => {
    const { view, destroy } = createViewWithSearch("hello world\nhello there\nhello again");
    view.dispatch({ selection: { anchor: 0 } });
    selectNextOccurrence(view);
    selectNextOccurrence(view);
    selectNextOccurrence(view);
    expect(view.state.selection.ranges.length).toBe(3);
    expect(view.state.doc.sliceString(view.state.selection.ranges[0]!.from, view.state.selection.ranges[0]!.to)).toBe("hello");
    expect(view.state.doc.sliceString(view.state.selection.ranges[1]!.from, view.state.selection.ranges[1]!.to)).toBe("hello");
    expect(view.state.doc.sliceString(view.state.selection.ranges[2]!.from, view.state.selection.ranges[2]!.to)).toBe("hello");
    destroy();
  });

  it("selectNextOccurrence with single occurrence: second call is no-op", () => {
    const { view, destroy } = createViewWithSearch("unique word here");
    view.dispatch({ selection: { anchor: 0 } });
    const first = selectNextOccurrence(view);
    expect(first).toBe(true);
    const second = selectNextOccurrence(view);
    expect(second).toBe(false);
    expect(view.state.selection.ranges.length).toBe(1);
    destroy();
  });

  it("repeated executeCommand('editor.selectNextOccurrence') builds multi-selection", () => {
    _clear();
    registerHandler("editor.selectNextOccurrence", (...args: unknown[]) => selectNextOccurrence(args[0] as EditorView));

    const { view, destroy } = createViewWithSearch("foo bar foo baz");
    view.dispatch({ selection: { anchor: 1 } });
    executeCommand("editor.selectNextOccurrence", view);
    executeCommand("editor.selectNextOccurrence", view);
    expect(view.state.selection.ranges.length).toBe(2);
    expect(view.state.selection.ranges[0]!.from).toBe(0);
    expect(view.state.selection.ranges[0]!.to).toBe(3);
    expect(view.state.selection.ranges[1]!.from).toBe(8);
    expect(view.state.selection.ranges[1]!.to).toBe(11);
    _clear();
    destroy();
  });

  it("repeated resolveKeymaps binding.run() builds multi-selection", () => {
    _clear();
    registerHandler("editor.selectNextOccurrence", (...args: unknown[]) => selectNextOccurrence(args[0] as EditorView));
    const { editorBindings } = resolveKeymaps([{ key: "Mod-g", command: "editor.selectNextOccurrence" }]);
    expect(editorBindings.length).toBe(1);

    const { view, destroy } = createViewWithSearch("foo bar foo baz");
    view.dispatch({ selection: { anchor: 1 } });
    const binding = editorBindings[0]!;
    binding.run!(view);
    binding.run!(view);
    expect(view.state.selection.ranges.length).toBe(2);
    expect(view.state.selection.ranges[0]!.from).toBe(0);
    expect(view.state.selection.ranges[0]!.to).toBe(3);
    expect(view.state.selection.ranges[1]!.from).toBe(8);
    expect(view.state.selection.ranges[1]!.to).toBe(11);
    _clear();
    destroy();
  });

  it("keymap compartment reconfigure between calls doesn't reset selection", () => {
    const keymapCompartment = new Compartment();
    const config = makeConfig();
    config.keymapCompartment = keymapCompartment;
    const exts = createExtensions(config);
    const state = EditorState.create({ doc: "foo bar foo baz", extensions: exts });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });

    view.dispatch({ selection: { anchor: 1 } });
    selectNextOccurrence(view);
    expect(view.state.selection.ranges.length).toBe(1);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);

    view.dispatch({ effects: keymapCompartment.reconfigure(keymap.of([...defaultKeymap, ...historyKeymap])) });

    selectNextOccurrence(view);
    expect(view.state.selection.ranges.length).toBe(2);
    expect(view.state.selection.ranges[0]!.from).toBe(0);
    expect(view.state.selection.ranges[0]!.to).toBe(3);
    expect(view.state.selection.ranges[1]!.from).toBe(8);
    expect(view.state.selection.ranges[1]!.to).toBe(11);

    view.destroy();
    parent.remove();
  });

  it("keymapCompartment reconfigure with full user bindings must not collapse multi-selection", () => {
    _clear();
    registerHandler("editor.selectNextOccurrence", (...args: unknown[]) => selectNextOccurrence(args[0] as EditorView));
    const { editorBindings } = resolveKeymaps([{ key: "Ctrl-g", command: "editor.selectNextOccurrence" }]);

    const keymapCompartment = new Compartment();
    const config = makeConfig();
    config.keymapCompartment = keymapCompartment;
    const exts = createExtensions({ ...config, keymapBindings: editorBindings });
    const state = EditorState.create({ doc: "foo bar foo baz foo", extensions: exts });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });

    view.dispatch({ selection: { anchor: 1 } });
    selectNextOccurrence(view);
    selectNextOccurrence(view);
    expect(view.state.selection.ranges.length).toBe(2);

    view.dispatch({
      effects: keymapCompartment.reconfigure(
        keymap.of([...editorBindings, ...defaultKeymap, ...historyKeymap]),
      ),
    });

    selectNextOccurrence(view);
    expect(view.state.selection.ranges.length).toBe(3);

    _clear();
    view.destroy();
    parent.remove();
  });

  it("searchKeymap findNext does not intercept user Ctrl-g binding", () => {
    _clear();
    registerHandler("editor.selectNextOccurrence", (...args: unknown[]) => selectNextOccurrence(args[0] as EditorView));
    const { editorBindings } = resolveKeymaps([{ key: "Ctrl-g", command: "editor.selectNextOccurrence" }]);

    const keymapCompartment = new Compartment();
    const config = makeConfig();
    config.keymapCompartment = keymapCompartment;
    const exts = createExtensions({ ...config, keymapBindings: editorBindings });
    const state = EditorState.create({ doc: "foo bar foo baz foo", extensions: exts });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });

    view.dispatch({ selection: { anchor: 1 } });

    const pressCtrlG = () => runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true }),
      "editor",
    );

    pressCtrlG();
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);

    pressCtrlG();
    expect(view.state.selection.ranges.length).toBe(2);

    _clear();
    view.destroy();
    parent.remove();
  });

  it("repeated Ctrl-g via runScopeHandlers builds multi-selection", () => {
    _clear();
    registerHandler("editor.selectNextOccurrence", (...args: unknown[]) => selectNextOccurrence(args[0] as EditorView));
    const { editorBindings } = resolveKeymaps([{ key: "Ctrl-g", command: "editor.selectNextOccurrence" }]);

    const keymapCompartment = new Compartment();
    const config = makeConfig();
    config.keymapCompartment = keymapCompartment;
    const exts = createExtensions({ ...config, keymapBindings: editorBindings });
    const state = EditorState.create({ doc: "foo bar foo baz foo", extensions: exts });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });

    view.dispatch({ selection: { anchor: 1 } });

    const pressCtrlG = () => runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true }),
      "editor",
    );

    const first = pressCtrlG();
    expect(first).toBe(true);
    expect(view.state.selection.ranges.length).toBe(1);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(3);

    const second = pressCtrlG();
    expect(second).toBe(true);
    expect(view.state.selection.ranges.length).toBe(2);

    const third = pressCtrlG();
    expect(third).toBe(true);
    expect(view.state.selection.ranges.length).toBe(3);

    _clear();
    view.destroy();
    parent.remove();
  });

  it("repeated Ctrl-g builds multi-selection even with keymapCompartment reconfigure between presses", () => {
    _clear();
    registerHandler("editor.selectNextOccurrence", (...args: unknown[]) => selectNextOccurrence(args[0] as EditorView));
    const { editorBindings } = resolveKeymaps([{ key: "Ctrl-g", command: "editor.selectNextOccurrence" }]);

    const keymapCompartment = new Compartment();
    const config = makeConfig();
    config.keymapCompartment = keymapCompartment;
    const exts = createExtensions({ ...config, keymapBindings: editorBindings });
    const state = EditorState.create({ doc: "foo bar foo baz foo", extensions: exts });
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({ state, parent });

    view.dispatch({ selection: { anchor: 1 } });

    const pressCtrlG = () => runScopeHandlers(
      view,
      new KeyboardEvent("keydown", { key: "g", ctrlKey: true, bubbles: true }),
      "editor",
    );

    pressCtrlG();
    expect(view.state.selection.ranges.length).toBe(1);
    expect(view.state.selection.main.from).toBe(0);

    view.dispatch({
      effects: keymapCompartment.reconfigure(
        keymap.of([...editorBindings, ...defaultKeymap, ...historyKeymap]),
      ),
    });

    pressCtrlG();
    expect(view.state.selection.ranges.length).toBe(2);

    view.dispatch({
      effects: keymapCompartment.reconfigure(
        keymap.of([...editorBindings, ...defaultKeymap, ...historyKeymap]),
      ),
    });

    pressCtrlG();
    expect(view.state.selection.ranges.length).toBe(3);

    _clear();
    view.destroy();
    parent.remove();
  });
});

describe("widgetSync annotation bypasses hasFocus guard", () => {
  it("fires onSelectionChange for widgetSync-annotated transaction without focus", () => {
    const onSelectionChange = vi.fn();
    const exts = createExtensions(makeConfig({ onSelectionChange }));
    const state = EditorState.create({ doc: "hello world", extensions: exts });
    const view = new EditorView({ state, parent: document.createElement("div") });

    view.dispatch({
      selection: { anchor: 5 },
      annotations: widgetSync.of(true),
    });

    expect(onSelectionChange).toHaveBeenCalledWith(1, 6);
    view.destroy();
  });

  it("does NOT fire onSelectionChange for regular selection without focus", () => {
    const onSelectionChange = vi.fn();
    const exts = createExtensions(makeConfig({ onSelectionChange }));
    const state = EditorState.create({ doc: "hello world", extensions: exts });
    const view = new EditorView({ state, parent: document.createElement("div") });

    view.dispatch({ selection: { anchor: 5 } });

    expect(onSelectionChange).not.toHaveBeenCalled();
    view.destroy();
  });
});
