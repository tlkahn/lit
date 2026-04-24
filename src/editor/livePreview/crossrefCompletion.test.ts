import { describe, it, expect, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import {
  parseTrigger,
  crossrefCompletionSource,
  type TriggerInfo,
} from "./crossrefCompletion";
import { frontmatterFacet } from "./crossref";
import { bibEntriesField, setBibData, type BibData } from "./citeproc";
import { mockInvoke } from "../../test/tauri-mock";

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
    expect(result).toEqual({ from: 6, phase: "id", refType: "bib", bibFrom: 1 });
  });

  it("[@bib:smi → bibFrom stays after @", () => {
    const result = trigger("[@bib:smi");
    expect(result).toEqual({ from: 6, phase: "id", refType: "bib", bibFrom: 1 });
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
    expect(result).not.toBeNull();
    expect(result!.phase).toBe("id");
    expect(result!.refType).toBe("bib");
    expect(result!.bibFrom).toBeDefined();
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
