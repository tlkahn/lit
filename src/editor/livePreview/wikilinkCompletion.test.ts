import { describe, it, expect, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import type { CompletionContext } from "@codemirror/autocomplete";
import {
  parseWikilinkTrigger,
  wikilinkCompletionSource,
  type WikilinkTriggerInfo,
} from "./wikilinkCompletion";
import { mockInvoke } from "../../test/tauri-mock";

function trigger(doc: string, cursorPos?: number): WikilinkTriggerInfo | null {
  const state = EditorState.create({ doc });
  const pos = cursorPos ?? doc.length;
  const line = state.doc.lineAt(pos);
  return parseWikilinkTrigger(line.text, line.from, pos - line.from);
}

describe("parseWikilinkTrigger", () => {
  it("returns null for plain text", () => {
    expect(trigger("hello world")).toBeNull();
  });

  it("returns null for single [", () => {
    expect(trigger("[")).toBeNull();
  });

  it("returns null for closed wikilink", () => {
    expect(trigger("[[Page]]")).toBeNull();
  });

  it("returns null for closed then text", () => {
    expect(trigger("[[Page]] then")).toBeNull();
  });

  it("[[ triggers page phase with empty query", () => {
    const result = trigger("[[");
    expect(result).toEqual({ from: 2, phase: "page", query: "" });
  });

  it("[[Par triggers page phase", () => {
    const result = trigger("[[Par");
    expect(result).toEqual({ from: 2, phase: "page", query: "Par" });
  });

  it("[[Page Name with spaces", () => {
    const result = trigger("[[Page Name");
    expect(result).toEqual({ from: 2, phase: "page", query: "Page Name" });
  });

  it("[[Page# triggers section phase", () => {
    const result = trigger("[[Page#");
    expect(result).toEqual({
      from: 7,
      phase: "section",
      pageName: "Page",
      query: "",
    });
  });

  it("[[Page#Sec in section phase", () => {
    const result = trigger("[[Page#Sec");
    expect(result).toEqual({
      from: 7,
      phase: "section",
      pageName: "Page",
      query: "Sec",
    });
  });

  it("[[Page Name#heading", () => {
    const result = trigger("[[Page Name#heading");
    expect(result).toEqual({
      from: 12,
      phase: "section",
      pageName: "Page Name",
      query: "heading",
    });
  });

  it("text before wikilink", () => {
    const result = trigger("see [[P");
    expect(result).toEqual({ from: 6, phase: "page", query: "P" });
  });

  it("[[#Sec same-page section", () => {
    const result = trigger("[[#Sec");
    expect(result).toEqual({
      from: 3,
      phase: "section",
      pageName: "",
      query: "Sec",
    });
  });

  it("multiple [[ takes last unclosed", () => {
    const result = trigger("[[a]] then [[b");
    expect(result).toEqual({ from: 13, phase: "page", query: "b" });
  });
});

describe("wikilinkCompletionSource — page phase", () => {
  const mockPages = [
    { title: "Alpha", relative_path: "Alpha.md", frontmatter: {}, created_at: 100, modified_at: 300 },
    { title: "Beta", relative_path: "sub/Beta.md", frontmatter: {}, created_at: 200, modified_at: 200 },
    { title: "Gamma", relative_path: "Gamma.md", frontmatter: {}, created_at: 50, modified_at: 400 },
  ];

  const mockSearchResults = [
    { id: "Alpha.md", title: "Alpha", score: -1.0, excerpt: "..." },
    { id: "Alpha2.md", title: "Alpha Two", score: -2.0, excerpt: "..." },
  ];

  beforeEach(() => {
    mockInvoke((cmd, args) => {
      if (cmd === "list_pages") return mockPages;
      if (cmd === "search_pages") return mockSearchResults;
      if (cmd === "get_page_headings") {
        return [
          { text: "Intro", level: 1 },
          { text: "Details", level: 2 },
        ];
      }
      throw new Error(`Unknown command: ${cmd} (args: ${JSON.stringify(args)})`);
    });
  });

  async function getCompletions(doc: string) {
    const state = EditorState.create({ doc });
    const ctx = {
      state,
      pos: doc.length,
      explicit: true,
    } as unknown as CompletionContext;
    return wikilinkCompletionSource(ctx);
  }

  it("returns null for plain text", async () => {
    expect(await getCompletions("hello")).toBeNull();
  });

  it("returns completions for [[ (empty query) via listPages, sorted by modified_at desc", async () => {
    const result = await getCompletions("[[");
    expect(result).not.toBeNull();
    expect(result!.options[0]!.label).toBe("Gamma");
    expect(result!.options[1]!.label).toBe("Alpha");
    expect(result!.options[2]!.label).toBe("Beta");
  });

  it("limits empty-query results to 10", async () => {
    const manyPages = Array.from({ length: 15 }, (_, i) => ({
      title: `Page ${i}`,
      relative_path: `p${i}.md`,
      frontmatter: {},
      created_at: 100,
      modified_at: 100 + i,
    }));
    mockInvoke((cmd) => {
      if (cmd === "list_pages") return manyPages;
      throw new Error(`Unknown command: ${cmd}`);
    });
    const result = await getCompletions("[[");
    expect(result!.options).toHaveLength(10);
  });

  it("returns completions for [[Par via searchPages", async () => {
    const result = await getCompletions("[[Alph");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0]!.label).toBe("Alpha");
  });

  it("searchPages called with query + '*' and limit 10", async () => {
    await getCompletions("[[Alph");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("search_pages", { query: "Alph*", limit: 10 });
  });

  it("from points to position after [[", async () => {
    const result = await getCompletions("[[Par");
    expect(result!.from).toBe(2);
  });

  it("option labels are page titles", async () => {
    const result = await getCompletions("[[");
    for (const opt of result!.options) {
      expect(typeof opt.label).toBe("string");
    }
  });

  it("option detail is relative_path", async () => {
    const result = await getCompletions("[[");
    expect(result!.options[1]!.detail).toBe("Alpha.md");
  });

  it("validFor matches non-bracket non-hash non-pipe chars", async () => {
    const result = await getCompletions("[[");
    expect(result!.validFor).toEqual(/^[^\]#|]*$/);
  });
});

describe("wikilinkCompletionSource — section phase", () => {
  beforeEach(() => {
    mockInvoke((cmd) => {
      if (cmd === "get_page_headings") {
        return [
          { text: "Intro", level: 1 },
          { text: "Details", level: 2 },
          { text: "Summary", level: 3 },
        ];
      }
      throw new Error(`Unknown command: ${cmd}`);
    });
  });

  async function getCompletions(doc: string) {
    const state = EditorState.create({ doc });
    const ctx = {
      state,
      pos: doc.length,
      explicit: true,
    } as unknown as CompletionContext;
    return wikilinkCompletionSource(ctx);
  }

  it("returns headings for [[Page# via getPageHeadings", async () => {
    const result = await getCompletions("[[Page#");
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(3);
  });

  it("from points to position after #", async () => {
    const result = await getCompletions("[[Page#");
    expect(result!.from).toBe(7);
  });

  it("heading text as option labels", async () => {
    const result = await getCompletions("[[Page#");
    expect(result!.options[0]!.label).toBe("Intro");
    expect(result!.options[1]!.label).toBe("Details");
    expect(result!.options[2]!.label).toBe("Summary");
  });

  it("heading level shown in detail", async () => {
    const result = await getCompletions("[[Page#");
    expect(result!.options[0]!.detail).toBe("h1");
    expect(result!.options[1]!.detail).toBe("h2");
  });

  it("returns null if getPageHeadings throws", async () => {
    mockInvoke(() => {
      throw new Error("Not found");
    });
    const result = await getCompletions("[[NonExistent#");
    expect(result).toBeNull();
  });

  it("same-page [[# uses extractHeadings from current doc (no IPC)", async () => {
    const doc = "# My Heading\n\nSome text\n\n## Sub Heading\n\n[[#";
    const state = EditorState.create({ doc });
    const ctx = {
      state,
      pos: doc.length,
      explicit: true,
    } as unknown as CompletionContext;

    mockInvoke(() => {
      throw new Error("Should not call IPC for same-page");
    });

    const result = await wikilinkCompletionSource(ctx);
    expect(result).not.toBeNull();
    expect(result!.options).toHaveLength(2);
    expect(result!.options[0]!.label).toBe("My Heading");
    expect(result!.options[1]!.label).toBe("Sub Heading");
  });
});
