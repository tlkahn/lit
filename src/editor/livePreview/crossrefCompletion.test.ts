import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { EditorState, type StateEffect } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import {
  parseTrigger,
  crossrefCompletionSource,
  _resetBibCacheForTesting,
  _getWorkspaceBibEntriesForTesting,
  bibReconciliationPlugin,
  type TriggerInfo,
} from "./crossrefCompletion";
import { frontmatterFacet } from "./crossref";
import { bibEntriesField, setBibData, notePathFacet, citeprocMatchesField, refetchBib, type BibData } from "./citeproc";
import { mockInvoke, mockListen, emitMockEvent } from "../../test/tauri-mock";
import { useWorkspaceStore } from "../../stores/workspace";
import type { BibEntry } from "../../lib/ipc";
import * as frontmatterBus from "../../lib/frontmatterBus";
import { EditorView } from "@codemirror/view";

function trigger(doc: string, cursorPos?: number): TriggerInfo | null {
  const state = EditorState.create({ doc });
  const pos = cursorPos ?? doc.length;
  const line = state.doc.lineAt(pos);
  return parseTrigger(line.text, line.from, pos - line.from);
}

describe("parseTrigger", () => {
  it("returns null for plain text", () => {
    expect(trigger("hello world")).toBeNull();
  });

  it("returns null for bare [", () => {
    expect(trigger("[")).toBeNull();
  });

  it("returns null for closed bracket [@fig:cat]", () => {
    expect(trigger("[@fig:cat]")).toBeNull();
  });

  it('[@  → phase "type"', () => {
    const result = trigger("[@");
    expect(result).toEqual({ from: 2, phase: "type" });
  });

  it('[@f → phase "type", from at f', () => {
    const result = trigger("[@f");
    expect(result).toEqual({ from: 2, phase: "type" });
  });

  it('[@fig: → phase "id", refType "fig"', () => {
    const result = trigger("[@fig:");
    expect(result).toEqual({ from: 6, phase: "id", refType: "fig" });
  });

  it('[@fig:c → phase "id", from after :', () => {
    const result = trigger("[@fig:c");
    expect(result).toEqual({ from: 6, phase: "id", refType: "fig" });
  });

  it('[@fig:cat; @ → phase "type" (batch)', () => {
    const result = trigger("[@fig:cat; @");
    expect(result).toEqual({ from: 12, phase: "type" });
  });

  it("[@fig:cat; @tbl:d → phase id, refType tbl (batch)", () => {
    const result = trigger("[@fig:cat; @tbl:d");
    expect(result).toEqual({ from: 16, phase: "id", refType: "tbl" });
  });

  it("[@bib: → phase id, refType bib, bibFrom after @", () => {
    const result = trigger("[@bib:");
    expect(result).toEqual({ from: 6, phase: "id", refType: "bib", bibFrom: 2 });
  });

  it("[@bib:smi → bibFrom stays after @", () => {
    const result = trigger("[@bib:smi");
    expect(result).toEqual({ from: 6, phase: "id", refType: "bib", bibFrom: 2 });
  });

  it("returns null for unknown ref type", () => {
    expect(trigger("[@xyz:")).toBeNull();
  });

  it("works with text before the bracket", () => {
    const result = trigger("see [@fig:");
    expect(result).toEqual({ from: 10, phase: "id", refType: "fig" });
  });

  it("batch bib: [@fig:cat; @bib:", () => {
    const result = trigger("[@fig:cat; @bib:");
    expect(result).toEqual({ from: 16, phase: "id", refType: "bib", bibFrom: 12 });
  });
});

describe("crossrefCompletionSource — type phase", () => {
  async function getCompletions(doc: string) {
    const state = EditorState.create({ doc, extensions: [bibEntriesField] });
    const ctx = {
      state,
      pos: doc.length,
      explicit: true,
    } as unknown as CompletionContext;
    return crossrefCompletionSource(ctx);
  }

  it("returns all 6 types for [@", async () => {
    const result = await getCompletions("[@");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(6);
    expect(result!.options.map((o) => o.label)).toEqual([
      "fig:", "tbl:", "sec:", "eq:", "lst:", "bib:",
    ]);
  });

  it("includes detail descriptions", async () => {
    const result = await getCompletions("[@");
    expect(result!.options[0]!.detail).toBe("Figure");
    expect(result!.options[5]!.detail).toBe("Bibliography");
  });

  it("type completions have apply functions for auto-chain", async () => {
    const result = await getCompletions("[@");
    for (const opt of result!.options) {
      expect(typeof opt.apply).toBe("function");
    }
  });

  it("validFor allows filtering by prefix", async () => {
    const result = await getCompletions("[@");
    expect(result!.validFor).toEqual(/^[a-z]*$/);
  });
});

describe("crossrefCompletionSource — crossref ID phase", () => {
  const mockDefs = [
    { ref_type: "fig", id: "cat", number: "1", caption: "A cat", line: 5, char_offset: 0 },
    { ref_type: "fig", id: "dog", number: "2", caption: null, line: 10, char_offset: 0 },
    { ref_type: "tbl", id: "data", number: "1", caption: "Some data", line: 15, char_offset: 0 },
  ];

  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "get_definitions") return mockDefs;
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  async function getCompletions(doc: string) {
    const state = EditorState.create({
      doc,
      extensions: [frontmatterFacet.of({}), bibEntriesField],
    });
    const ctx = {
      state,
      pos: doc.length,
      explicit: true,
    } as unknown as CompletionContext;
    return crossrefCompletionSource(ctx);
  }

  it("returns only fig definitions for [@fig:", async () => {
    const result = await getCompletions("[@fig:");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0]!.label).toBe("cat");
    expect(result!.options[1]!.label).toBe("dog");
  });

  it("detail includes number and caption", async () => {
    const result = await getCompletions("[@fig:");
    expect(result!.options[0]!.detail).toBe("1: A cat");
  });

  it("detail without caption shows only number", async () => {
    const result = await getCompletions("[@fig:");
    expect(result!.options[1]!.detail).toBe("2");
  });

  it("returns only tbl definitions for [@tbl:", async () => {
    const result = await getCompletions("[@tbl:");
    expect(result!.options).toHaveLength(1);
    expect(result!.options[0]!.label).toBe("data");
  });

  it("from points to after colon", async () => {
    const result = await getCompletions("[@fig:");
    expect(result!.from).toBe(6);
  });

  it("validFor allows id chars", async () => {
    const result = await getCompletions("[@fig:");
    expect(result!.validFor).toEqual(/^[a-zA-Z0-9_-]*$/);
  });
});

describe("crossrefCompletionSource — bib phase", () => {
  const bibData: BibData = {
    entries: [
      { key: "smith2020", authors: ["Smith"], title: "Cats", year: "2020", entry_type: "article", line_number: 1 },
      { key: "jones2021", authors: ["Jones"], title: "Dogs", year: "2021", entry_type: "article", line_number: 5 },
    ],
    renderedCitations: { smith2020: "Smith (2020)", jones2021: "Jones (2021)" },
    byKey: new Map(),
  };

  async function getCompletions(doc: string) {
    let state = EditorState.create({
      doc,
      extensions: [bibEntriesField, frontmatterFacet.of({})],
    });
    state = state.update({ effects: setBibData.of(bibData) }).state;
    const ctx = {
      state,
      pos: doc.length,
      explicit: true,
    } as unknown as CompletionContext;
    return crossrefCompletionSource(ctx);
  }

  it("returns bib entries from state field (no IPC)", async () => {
    const result = await getCompletions("[@bib:");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0]!.label).toBe("smith2020");
    expect(result!.options[1]!.label).toBe("jones2021");
  });

  it("detail is rendered citation form", async () => {
    const result = await getCompletions("[@bib:");
    expect(result!.options[0]!.detail).toBe("Smith (2020)");
  });

  it("bib completions have apply functions", async () => {
    const result = await getCompletions("[@bib:");
    for (const opt of result!.options) {
      expect(typeof opt.apply).toBe("function");
    }
  });

  it("from is after colon, but apply replaces from bibFrom", async () => {
    const result = await getCompletions("[@bib:");
    expect(result!.from).toBe(6);
  });
});

describe("crossrefCompletionSource — returns null", () => {
  it("returns null for plain text", async () => {
    const state = EditorState.create({ doc: "hello" });
    const ctx = {
      state,
      pos: 5,
      explicit: true,
    } as unknown as CompletionContext;
    expect(await crossrefCompletionSource(ctx)).toBeNull();
  });
});

describe("workspace bib cache (getWorkspaceBibEntries)", () => {
  const workspaceEntries: BibEntry[] = [
    { key: "smith2020", authors: ["Smith"], title: "Cats", year: "2020", entry_type: "article", line_number: 1 },
    { key: "jones2021", authors: ["Jones, J."], title: "Dogs", year: "2021", entry_type: "article", line_number: 5 },
  ];

  beforeEach(() => {
    _resetBibCacheForTesting();
  });

  it("caches entries after first fetch -- second call does not invoke IPC", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") {
        callCount++;
        return workspaceEntries;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    await _getWorkspaceBibEntriesForTesting("/workspace");
    await _getWorkspaceBibEntriesForTesting("/workspace");
    expect(callCount).toBe(1);
  });

  it("invalidates cache when lit:bib-items-changed fires", async () => {
    let callCount = 0;
    mockListen();
    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") {
        callCount++;
        return workspaceEntries;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    await _getWorkspaceBibEntriesForTesting("/workspace");
    expect(callCount).toBe(1);

    emitMockEvent("lit:bib-items-changed", {});
    await _getWorkspaceBibEntriesForTesting("/workspace");
    expect(callCount).toBe(2);
  });

  it("coalesces concurrent requests into one IPC call", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") {
        callCount++;
        return workspaceEntries;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const [r1, r2] = await Promise.all([
      _getWorkspaceBibEntriesForTesting("/workspace"),
      _getWorkspaceBibEntriesForTesting("/workspace"),
    ]);
    expect(callCount).toBe(1);
    expect(r1.length).toBe(2);
    expect(r2.length).toBe(2);
  });

  it("retries on next invocation after fetch failure", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") {
        callCount++;
        if (callCount === 1) throw new Error("DB error");
        return workspaceEntries;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const r1 = await _getWorkspaceBibEntriesForTesting("/workspace");
    expect(r1).toEqual([]);

    const r2 = await _getWorkspaceBibEntriesForTesting("/workspace");
    expect(r2.length).toBe(2);
    expect(callCount).toBe(2);
  });

  it("resets cache when workspace path changes", async () => {
    const paths: string[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "list_bib_entries") {
        paths.push((args as { workspacePath: string }).workspacePath);
        return workspaceEntries;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    await _getWorkspaceBibEntriesForTesting("/workspace");
    await _getWorkspaceBibEntriesForTesting("/workspace2");

    expect(paths).toEqual(["/workspace", "/workspace2"]);
  });

  it("does not invoke IPC on every call (regression)", async () => {
    let callCount = 0;
    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") {
        callCount++;
        return workspaceEntries;
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    for (let i = 0; i < 5; i++) {
      await _getWorkspaceBibEntriesForTesting("/workspace");
    }
    expect(callCount).toBe(1);
  });
});

describe("bibReconciliationPlugin -- manual-typing reconciliation", () => {
  const workspaceEntries: BibEntry[] = [
    { key: "jones2021", authors: ["Jones"], title: "Dogs", year: "2021", entry_type: "article", line_number: 5 },
    { key: "smith2020", authors: ["Smith"], title: "Cats", year: "2020", entry_type: "article", line_number: 1 },
  ];

  // bibData where only smith2020 is resolved
  const bibData: BibData = {
    entries: [
      { key: "smith2020", authors: ["Smith"], title: "Cats", year: "2020", entry_type: "article", line_number: 1 },
    ],
    renderedCitations: { smith2020: "Smith (2020)" },
    byKey: new Map([["smith2020", { key: "smith2020", authors: ["Smith"], title: "Cats", year: "2020", entry_type: "article", line_number: 1 }]]),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    _resetBibCacheForTesting();
    useWorkspaceStore.setState({ workspacePath: "/workspace" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createEditorView(doc: string, bib: BibData, notePath: string): EditorView {
    const exts = [
      bibEntriesField,
      citeprocMatchesField,
      notePathFacet.of(notePath),
      frontmatterFacet.of({}),
      bibReconciliationPlugin,
    ];
    let state = EditorState.create({ doc, extensions: exts });
    state = state.update({ effects: setBibData.of(bib) }).state;
    const parent = document.createElement("div");
    return new EditorView({ state, parent });
  }

  it("calls ensureInCompanionBib for unresolved keys that exist in workspace DB", async () => {
    const ensureCalls: string[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "list_bib_entries") return workspaceEntries;
      if (cmd === "ensure_in_companion_bib") {
        ensureCalls.push((args as { citeKey: string }).citeKey);
        return { bib_path: "refs.bib", bibliography_value: null };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    // Doc has [@jones2021] which is NOT in bibData.byKey
    const view = createEditorView("see [@jones2021]", bibData, "notes/Test.md");

    // Advance past the 1s debounce
    await vi.advanceTimersByTimeAsync(1100);

    expect(ensureCalls).toContain("jones2021");
    view.destroy();
  });

  it("does not reconcile keys already in note-scoped bib data", async () => {
    const ensureCalls: string[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "list_bib_entries") return workspaceEntries;
      if (cmd === "ensure_in_companion_bib") {
        ensureCalls.push((args as { citeKey: string }).citeKey);
        return { bib_path: "refs.bib", bibliography_value: null };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    // smith2020 IS in bibData.byKey -- should not trigger reconciliation
    const view = createEditorView("see [@smith2020]", bibData, "notes/Test.md");
    await vi.advanceTimersByTimeAsync(1100);

    expect(ensureCalls).toHaveLength(0);
    view.destroy();
  });

  it("reconciles each key at most once per editor session", async () => {
    const ensureCalls: string[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "list_bib_entries") return workspaceEntries;
      if (cmd === "ensure_in_companion_bib") {
        ensureCalls.push((args as { citeKey: string }).citeKey);
        return { bib_path: "refs.bib", bibliography_value: null };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const view = createEditorView("see [@jones2021]", bibData, "notes/Test.md");
    await vi.advanceTimersByTimeAsync(1100);
    expect(ensureCalls).toHaveLength(1);

    // Simulate another doc change
    view.dispatch({ changes: { from: 0, insert: " " } });
    await vi.advanceTimersByTimeAsync(1100);

    // Should still be only 1 call
    expect(ensureCalls).toHaveLength(1);
    view.destroy();
  });

  it("emits frontmatter patch when bibliography_value is returned", async () => {
    const emitSpy = vi.spyOn(frontmatterBus, "emitFrontmatterPatch");

    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") return workspaceEntries;
      if (cmd === "ensure_in_companion_bib") {
        return { bib_path: "assets/bib/Test.bib", bibliography_value: "assets/bib/Test.bib" };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const view = createEditorView("see [@jones2021]", bibData, "notes/Test.md");
    await vi.advanceTimersByTimeAsync(1100);

    expect(emitSpy).toHaveBeenCalledWith("notes/Test.md", {
      bibliography: "assets/bib/Test.bib",
    });

    emitSpy.mockRestore();
    view.destroy();
  });

  it("skips keys that do not exist in workspace DB", async () => {
    const ensureCalls: string[] = [];
    mockInvoke((cmd, args) => {
      if (cmd === "list_bib_entries") return workspaceEntries;
      if (cmd === "ensure_in_companion_bib") {
        ensureCalls.push((args as { citeKey: string }).citeKey);
        return { bib_path: "refs.bib", bibliography_value: null };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    // "nonexistent" is not in workspaceEntries and not in bibData.byKey
    const view = createEditorView("see [@nonexistent]", bibData, "notes/Test.md");
    await vi.advanceTimersByTimeAsync(1100);

    expect(ensureCalls).toHaveLength(0);
    view.destroy();
  });

  it("dispatches refetchBib after reconciling unresolved keys", async () => {
    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") return workspaceEntries;
      if (cmd === "ensure_in_companion_bib") {
        return { bib_path: "refs.bib", bibliography_value: null };
      }
      throw new Error(`Unknown command: ${cmd}`);
    });

    const view = createEditorView("see [@jones2021]", bibData, "notes/Test.md");
    const dispatchSpy = vi.spyOn(view, "dispatch");

    await vi.advanceTimersByTimeAsync(1100);

    expect(dispatchedRefetchBib(dispatchSpy)).toBe(true);

    dispatchSpy.mockRestore();
    view.destroy();
  });

  it("logs console.warn on ensureInCompanionBib failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    mockInvoke((cmd) => {
      if (cmd === "list_bib_entries") return workspaceEntries;
      if (cmd === "ensure_in_companion_bib") throw new Error("disk full");
      throw new Error(`Unknown command: ${cmd}`);
    });

    const view = createEditorView("see [@jones2021]", bibData, "notes/Test.md");
    await vi.advanceTimersByTimeAsync(1100);

    expect(warnSpy).toHaveBeenCalled();
    const msg = warnSpy.mock.calls.find((c) =>
      typeof c[0] === "string" && c[0].includes("jones2021"),
    );
    expect(msg).toBeTruthy();

    warnSpy.mockRestore();
    view.destroy();
  });
});

/** Helper: check whether any dispatch call includes a refetchBib effect */
function dispatchedRefetchBib(dispatchSpy: { mock: { calls: unknown[][] } }): boolean {
  return dispatchSpy.mock.calls.some((call) => {
    const spec = call[0] as { effects?: StateEffect<unknown> | StateEffect<unknown>[] } | undefined;
    if (!spec?.effects) return false;
    const effects = Array.isArray(spec.effects) ? spec.effects : [spec.effects];
    return effects.some((e) => e.is(refetchBib));
  });
}
