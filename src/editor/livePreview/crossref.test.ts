import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState, Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  crossrefField,
  setCrossrefData,
  isInEditableRange,
  frontmatterFacet,
  crossrefExtension,
} from "./crossref";
import type { AllDecorations } from "../../lib/ipc";
import { mockInvoke } from "../../test/tauri-mock";

const EMPTY: AllDecorations = { citations: [], definition_tags: [] };

function makeState(doc = "hello world", data?: AllDecorations) {
  const state = EditorState.create({
    doc,
    extensions: [crossrefField],
  });
  if (data) {
    return state.update({ effects: setCrossrefData.of(data) }).state;
  }
  return state;
}

describe("crossrefField", () => {
  it("initializes with empty AllDecorations", () => {
    const state = makeState();
    const value = state.field(crossrefField);
    expect(value).toEqual(EMPTY);
  });

  it("setCrossrefData effect updates the field value", () => {
    const data: AllDecorations = {
      citations: [
        {
          char_start: 0,
          char_end: 5,
          rendered_text: "Fig. 1",
          is_valid: true,
          original: "[@fig:cat]",
          target_line: 1,
          target_char_offset: 20,
        },
      ],
      definition_tags: [],
    };
    const state = makeState("hello world", data);
    expect(state.field(crossrefField)).toEqual(data);
  });
});

describe("isInEditableRange", () => {
  it("cursor inside range returns true", () => {
    expect(isInEditableRange(5, 15, 10, 10, 10)).toBe(true);
  });

  it("cursor outside range returns false", () => {
    expect(isInEditableRange(5, 15, 20, 20, 20)).toBe(false);
  });

  it("1-char buffer works at boundaries", () => {
    expect(isInEditableRange(5, 15, 4, 4, 4)).toBe(true);
    expect(isInEditableRange(5, 15, 16, 16, 16)).toBe(true);
    expect(isInEditableRange(5, 15, 3, 3, 3)).toBe(false);
    expect(isInEditableRange(5, 15, 17, 17, 17)).toBe(false);
  });

  it("active selection overlap returns true", () => {
    expect(isInEditableRange(5, 15, 0, 0, 10)).toBe(true);
    expect(isInEditableRange(5, 15, 20, 10, 20)).toBe(true);
  });

  it("selection fully before range returns false", () => {
    expect(isInEditableRange(10, 20, 2, 0, 5)).toBe(false);
  });
});

describe("decoration provider", () => {
  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return EMPTY;
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  function makeViewWithData(doc: string, data: AllDecorations, cursorPos = 0) {
    const state = EditorState.create({
      doc,
      selection: { anchor: cursorPos },
      extensions: [crossrefExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });
    view.dispatch({ effects: setCrossrefData.of(data) });
    return view;
  }

  it("builds Decoration.replace for valid citations outside cursor range", () => {
    const doc = "Look at [@fig:cat] in the text";
    const data: AllDecorations = {
      citations: [
        {
          char_start: 8,
          char_end: 18,
          rendered_text: "Fig. 1",
          is_valid: true,
          original: "[@fig:cat]",
          target_line: 5,
          target_char_offset: 100,
        },
      ],
      definition_tags: [],
    };
    const view = makeViewWithData(doc, data, 0);
    const decos = view.state.field(crossrefField);
    expect(decos.citations).toHaveLength(1);
    view.destroy();
  });

  it("skips citations where cursor is in editable range", () => {
    const doc = "Look at [@fig:cat] in the text";
    const data: AllDecorations = {
      citations: [
        {
          char_start: 8,
          char_end: 18,
          rendered_text: "Fig. 1",
          is_valid: true,
          original: "[@fig:cat]",
          target_line: 5,
          target_char_offset: 100,
        },
      ],
      definition_tags: [],
    };
    const view = makeViewWithData(doc, data, 10);
    const decos = view.state.field(crossrefField);
    expect(decos.citations).toHaveLength(1);
    view.destroy();
  });

  it("skips definition tags where is_valid is false", () => {
    const doc = "Some {#fig:bad} text";
    const data: AllDecorations = {
      citations: [],
      definition_tags: [
        {
          char_start: 5,
          char_end: 15,
          rendered_text: "#Fig. ?",
          is_valid: false,
          original: "{#fig:bad}",
          ref_type: "fig",
          id: "bad",
        },
      ],
    };
    const view = makeViewWithData(doc, data, 0);
    const decos = view.state.field(crossrefField);
    expect(decos.definition_tags).toHaveLength(1);
    expect(decos.definition_tags[0]!.is_valid).toBe(false);
    view.destroy();
  });

  it("filters out-of-bounds positions", () => {
    const doc = "short";
    const data: AllDecorations = {
      citations: [
        {
          char_start: -1,
          char_end: 3,
          rendered_text: "Fig. 1",
          is_valid: true,
          original: "[@fig:x]",
          target_line: null,
          target_char_offset: null,
        },
        {
          char_start: 2,
          char_end: 100,
          rendered_text: "Fig. 2",
          is_valid: true,
          original: "[@fig:y]",
          target_line: null,
          target_char_offset: null,
        },
        {
          char_start: 3,
          char_end: 2,
          rendered_text: "Fig. 3",
          is_valid: true,
          original: "[@fig:z]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    };
    const view = makeViewWithData(doc, data, 0);
    const fieldData = view.state.field(crossrefField);
    expect(fieldData.citations).toHaveLength(3);
    view.destroy();
  });
});

describe("frontmatterFacet", () => {
  it("combine returns first value or empty object", () => {
    const state1 = EditorState.create({
      doc: "",
      extensions: [frontmatterFacet.of({ title: "test" })],
    });
    expect(state1.facet(frontmatterFacet)).toEqual({ title: "test" });

    const state2 = EditorState.create({
      doc: "",
      extensions: [],
    });
    expect(state2.facet(frontmatterFacet)).toEqual({});
  });
});

describe("crossrefPlugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces IPC call on doc change", async () => {
    const mockData: AllDecorations = {
      citations: [
        {
          char_start: 0,
          char_end: 5,
          rendered_text: "Fig. 1",
          is_valid: true,
          original: "[@fig:x]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    };

    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") return mockData;
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "hello",
      extensions: [crossrefExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    view.dispatch({ changes: { from: 5, insert: " world" } });

    await vi.advanceTimersByTimeAsync(100);

    view.dispatch({ changes: { from: 11, insert: "!" } });

    await vi.advanceTimersByTimeAsync(150);

    const data = view.state.field(crossrefField);
    expect(data.citations).toHaveLength(1);

    view.destroy();
  });

  it("does NOT fire IPC on selection-only change", async () => {
    let ipcCallCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") {
        ipcCallCount++;
        return EMPTY;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "hello world",
      extensions: [crossrefExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);
    const initialCalls = ipcCallCount;

    view.dispatch({ selection: { anchor: 5 } });
    await vi.advanceTimersByTimeAsync(200);

    expect(ipcCallCount).toBe(initialCalls);

    view.destroy();
  });

  it("discards out-of-order stale response instead of overwriting newer data", async () => {
    type Resolver = { content: string; resolve: (v: AllDecorations) => void };
    const resolvers: Resolver[] = [];

    mockInvoke((cmd, args) => {
      if (cmd === "resolve_all_decorations") {
        return new Promise<AllDecorations>((resolve) => {
          resolvers.push({
            content: (args as { content: string }).content,
            resolve,
          });
        });
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "hello",
      extensions: [crossrefExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    // IPC#1 fires immediately on construction
    await vi.advanceTimersByTimeAsync(0);
    expect(resolvers).toHaveLength(1);
    expect(resolvers[0]!.content).toBe("hello");

    // Edit doc -> schedules IPC#2 after debounce
    view.dispatch({ changes: { from: 5, insert: " world" } });
    await vi.advanceTimersByTimeAsync(150);
    expect(resolvers).toHaveLength(2);
    expect(resolvers[1]!.content).toBe("hello world");

    const data2: AllDecorations = {
      citations: [
        {
          char_start: 0,
          char_end: 5,
          rendered_text: "Fresh",
          is_valid: true,
          original: "[@fig:fresh]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    };

    // Resolve IPC#2 first (newer)
    resolvers[1]!.resolve(data2);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.field(crossrefField)).toBe(data2);

    const data1: AllDecorations = {
      citations: [
        {
          char_start: 0,
          char_end: 3,
          rendered_text: "Stale",
          is_valid: true,
          original: "[@fig:stale]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    };

    // Resolve IPC#1 late (older) - must NOT overwrite
    resolvers[0]!.resolve(data1);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.field(crossrefField)).toBe(data2);

    view.destroy();
  });

  it("converges after a response is discarded as stale", async () => {
    type Resolver = { content: string; resolve: (v: AllDecorations) => void };
    const resolvers: Resolver[] = [];

    mockInvoke((cmd, args) => {
      if (cmd === "resolve_all_decorations") {
        return new Promise<AllDecorations>((resolve) => {
          resolvers.push({
            content: (args as { content: string }).content,
            resolve,
          });
        });
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "aaa",
      extensions: [crossrefExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    // IPC#1 in flight for doc "aaa"
    await vi.advanceTimersByTimeAsync(0);
    expect(resolvers).toHaveLength(1);

    // Edit doc to "aaabbb"
    view.dispatch({ changes: { from: 3, insert: "bbb" } });

    // Resolve IPC#1 (stale - doc changed) - should trigger retry
    resolvers[0]!.resolve(EMPTY);
    await vi.advanceTimersByTimeAsync(0);

    // Advance past debounce to let retry fire
    await vi.advanceTimersByTimeAsync(150);

    // The retry IPC should have been called with the updated doc
    const retryResolver = resolvers.find((r) => r.content === "aaabbb");
    expect(retryResolver).toBeDefined();

    const freshData: AllDecorations = {
      citations: [
        {
          char_start: 0,
          char_end: 3,
          rendered_text: "Converged",
          is_valid: true,
          original: "[@fig:ok]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    };

    retryResolver!.resolve(freshData);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.field(crossrefField)).toBe(freshData);

    view.destroy();
  });

  it("fires IPC when frontmatterFacet is reconfigured without doc change", async () => {
    let ipcCallCount = 0;
    let lastFrontmatter: Record<string, unknown> = {};

    mockInvoke((cmd, args) => {
      if (cmd === "resolve_all_decorations") {
        ipcCallCount++;
        lastFrontmatter = (args as { frontmatter: Record<string, unknown> }).frontmatter;
        return EMPTY;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const fmCompartment = new Compartment();
    const state = EditorState.create({
      doc: "hello",
      extensions: [crossrefExtension(), fmCompartment.of(frontmatterFacet.of({ a: 1 }))],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);
    const initialCalls = ipcCallCount;
    expect(lastFrontmatter).toEqual({ a: 1 });

    // Reconfigure frontmatter without doc change
    view.dispatch({
      effects: fmCompartment.reconfigure(frontmatterFacet.of({ a: 2 })),
    });
    await vi.advanceTimersByTimeAsync(150);

    expect(ipcCallCount).toBe(initialCalls + 1);
    expect(lastFrontmatter).toEqual({ a: 2 });

    view.destroy();
  });

  it("does not dispatch when IPC resolves after view destroy", async () => {
    let resolveIPC: (v: AllDecorations) => void = () => {};

    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") {
        return new Promise<AllDecorations>((r) => {
          resolveIPC = r;
        });
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "hello",
      extensions: [crossrefExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    // IPC in flight
    await vi.advanceTimersByTimeAsync(0);

    const dispatchSpy = vi.spyOn(view, "dispatch");

    // Destroy the view while IPC is still in flight
    view.destroy();

    // Resolve IPC after destroy
    resolveIPC({
      citations: [
        {
          char_start: 0,
          char_end: 5,
          rendered_text: "Late",
          is_valid: true,
          original: "[@fig:late]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    });
    await vi.advanceTimersByTimeAsync(0);

    const crossrefDispatches = dispatchSpy.mock.calls.filter((call) => {
      const arg = call[0] as { effects?: StateEffect<unknown>[] | StateEffect<unknown> };
      if (!arg.effects) return false;
      const effects = Array.isArray(arg.effects) ? arg.effects : [arg.effects];
      return effects.some((e: StateEffect<unknown>) => e.is(setCrossrefData));
    });
    expect(crossrefDispatches).toHaveLength(0);
  });

  it("stale check: discards IPC result if frontmatter changed during flight and converges", async () => {
    type Resolver = {
      content: string;
      frontmatter: Record<string, unknown>;
      resolve: (v: AllDecorations) => void;
    };
    const resolvers: Resolver[] = [];

    mockInvoke((cmd, args) => {
      if (cmd === "resolve_all_decorations") {
        return new Promise<AllDecorations>((resolve) => {
          resolvers.push({
            content: (args as { content: string }).content,
            frontmatter: (args as { frontmatter: Record<string, unknown> }).frontmatter,
            resolve,
          });
        });
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const fmCompartment = new Compartment();
    const state = EditorState.create({
      doc: "hello",
      extensions: [crossrefExtension(), fmCompartment.of(frontmatterFacet.of({ a: 1 }))],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    // IPC#1 fires immediately on construction
    await vi.advanceTimersByTimeAsync(0);
    expect(resolvers).toHaveLength(1);
    expect(resolvers[0]!.frontmatter).toEqual({ a: 1 });

    // Reconfigure frontmatter without doc change - do NOT advance past debounce
    view.dispatch({
      effects: fmCompartment.reconfigure(frontmatterFacet.of({ a: 2 })),
    });

    // Resolve IPC#1 with stale frontmatter data
    const staleData: AllDecorations = {
      citations: [
        {
          char_start: 0,
          char_end: 5,
          rendered_text: "Stale",
          is_valid: true,
          original: "[@fig:stale]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    };
    resolvers[0]!.resolve(staleData);
    await vi.advanceTimersByTimeAsync(0);

    // Stale data should be discarded
    expect(view.state.field(crossrefField)).toEqual(EMPTY);

    // Advance past debounce to let retry fire
    await vi.advanceTimersByTimeAsync(150);

    // A new resolver should have fired with updated frontmatter
    const retryResolver = resolvers.find((r) => r.frontmatter.a === 2);
    expect(retryResolver).toBeDefined();

    // Resolve with fresh data
    const freshData: AllDecorations = {
      citations: [
        {
          char_start: 0,
          char_end: 5,
          rendered_text: "Fresh",
          is_valid: true,
          original: "[@fig:fresh]",
          target_line: null,
          target_char_offset: null,
        },
      ],
      definition_tags: [],
    };
    retryResolver!.resolve(freshData);
    await vi.advanceTimersByTimeAsync(0);
    expect(view.state.field(crossrefField)).toBe(freshData);

    view.destroy();
  });

  it("stale check: discards IPC result if doc changed during flight", async () => {
    let resolveIPC: (v: AllDecorations) => void = () => {};

    mockInvoke((cmd) => {
      if (cmd === "resolve_all_decorations") {
        return new Promise<AllDecorations>((r) => {
          resolveIPC = r;
        });
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const state = EditorState.create({
      doc: "hello",
      extensions: [crossrefExtension()],
    });
    const view = new EditorView({ state, parent: document.createElement("div") });

    await vi.advanceTimersByTimeAsync(0);

    view.dispatch({ changes: { from: 5, insert: " changed" } });

    resolveIPC({
        citations: [
          {
            char_start: 0,
            char_end: 5,
            rendered_text: "Stale",
            is_valid: true,
            original: "stale",
            target_line: null,
            target_char_offset: null,
          },
        ],
        definition_tags: [],
      });

    await vi.advanceTimersByTimeAsync(0);

    const data = view.state.field(crossrefField);
    expect(data).toEqual(EMPTY);

    view.destroy();
  });
});
