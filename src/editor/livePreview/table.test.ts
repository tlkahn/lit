import { describe, it, expect, vi } from "vitest";
import { parseTableAlignment, parseTable, renderInlineMarkdown, getCellPosition, serializeTable, stripQuotePrefixes, applyQuotePrefixes } from "./table";
import { getKatexSync } from "./katexLoader";

const mockKatex = {
  render: vi.fn(),
  renderToString: vi.fn((tex: string) => `<span class="katex">${tex}</span>`),
};

vi.mock("./katexLoader", () => ({
  getKatexSync: vi.fn(() => mockKatex),
  loadKatex: vi.fn(async () => mockKatex),
  resetKatexLoader: vi.fn(),
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

describe("parseTableAlignment", () => {
  it("parses default alignment", () => {
    expect(parseTableAlignment("| --- |")).toEqual(["default"]);
  });

  it("parses left alignment", () => {
    expect(parseTableAlignment("| :--- |")).toEqual(["left"]);
  });

  it("parses right alignment", () => {
    expect(parseTableAlignment("| ---: |")).toEqual(["right"]);
  });

  it("parses center alignment", () => {
    expect(parseTableAlignment("| :---: |")).toEqual(["center"]);
  });

  it("parses mixed alignments", () => {
    expect(parseTableAlignment("| :--- | ---: | :---: | --- |")).toEqual([
      "left",
      "right",
      "center",
      "default",
    ]);
  });

  it("handles minimal separator", () => {
    expect(parseTableAlignment("| - |")).toEqual(["default"]);
  });
});

describe("parseTable", () => {
  it("parses a basic 2x2 table", () => {
    const result = parseTable("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(result).toEqual({
      headers: ["a", "b"],
      alignments: ["default", "default"],
      rows: [["1", "2"]],
    });
  });

  it("applies alignment markers correctly", () => {
    const result = parseTable("| h1 | h2 |\n| :--- | ---: |\n| a | b |");
    expect(result).not.toBeNull();
    expect(result!.alignments).toEqual(["left", "right"]);
  });

  it("parses multiple body rows", () => {
    const result = parseTable(
      "| h |\n| --- |\n| r1 |\n| r2 |\n| r3 |",
    );
    expect(result).not.toBeNull();
    expect(result!.rows).toEqual([["r1"], ["r2"], ["r3"]]);
  });

  it("trims leading/trailing whitespace in cells", () => {
    const result = parseTable("|  a  |  b  |\n| --- | --- |\n|  1  |  2  |");
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(["a", "b"]);
    expect(result!.rows[0]).toEqual(["1", "2"]);
  });

  it("preserves inline markdown as raw text", () => {
    const result = parseTable("| **bold** |\n| --- |\n| *italic* |");
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(["**bold**"]);
    expect(result!.rows[0]).toEqual(["*italic*"]);
  });

  it("returns null for single-line input", () => {
    expect(parseTable("| a | b |")).toBeNull();
  });

  it("returns null for missing delimiter row", () => {
    expect(parseTable("| a | b |\n| 1 | 2 |")).toBeNull();
  });

  it("parses header-only table (no body rows)", () => {
    const result = parseTable("| H |\n| --- |");
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(["H"]);
    expect(result!.rows).toEqual([]);
  });

  it("pads uneven columns with empty strings", () => {
    const result = parseTable("| a | b | c |\n| --- | --- | --- |\n| 1 |");
    expect(result).not.toBeNull();
    expect(result!.rows[0]).toEqual(["1", "", ""]);
  });

  it("parses tables without leading/trailing pipes", () => {
    const result = parseTable("a | b\n---|---\n1 | 2");
    expect(result).not.toBeNull();
    expect(result!.headers).toEqual(["a", "b"]);
    expect(result!.rows).toEqual([["1", "2"]]);
  });
});

describe("renderInlineMarkdown", () => {
  it("returns plain text unchanged", () => {
    expect(renderInlineMarkdown("hello world")).toBe("hello world");
  });

  it("escapes HTML entities", () => {
    expect(renderInlineMarkdown("<script>")).toBe("&lt;script&gt;");
  });

  it("renders bold with **", () => {
    expect(renderInlineMarkdown("**bold**")).toBe("<strong>bold</strong>");
  });

  it("renders italic with *", () => {
    expect(renderInlineMarkdown("*italic*")).toBe("<em>italic</em>");
  });

  it("renders inline code", () => {
    expect(renderInlineMarkdown("`code`")).toBe("<code>code</code>");
  });

  it("code protects content from other transforms", () => {
    expect(renderInlineMarkdown("`**not bold**`")).toBe(
      "<code>**not bold**</code>",
    );
  });

  it("renders links", () => {
    expect(renderInlineMarkdown("[text](url)")).toBe(
      '<a href="url" class="cm-preview-link">text</a>',
    );
  });

  it("renders wikilinks", () => {
    expect(renderInlineMarkdown("[[Page]]")).toBe(
      '<span class="cm-preview-wikilink" data-wikilink-target="Page">Page</span>',
    );
  });

  it("renders wikilinks with alias", () => {
    expect(renderInlineMarkdown("[[Page|Display]]")).toBe(
      '<span class="cm-preview-wikilink" data-wikilink-target="Page">Display</span>',
    );
  });

  it("wikilink with section has data-wikilink-section", () => {
    expect(renderInlineMarkdown("[[Page#Section]]")).toBe(
      '<span class="cm-preview-wikilink" data-wikilink-target="Page" data-wikilink-section="Section">Page#Section</span>',
    );
  });

  it("aliased wikilink with section stores both attributes", () => {
    expect(renderInlineMarkdown("[[Page#Section|Display]]")).toBe(
      '<span class="cm-preview-wikilink" data-wikilink-target="Page" data-wikilink-section="Section">Display</span>',
    );
  });

  it("same-page link stores empty target with section", () => {
    expect(renderInlineMarkdown("[[#Heading]]")).toBe(
      '<span class="cm-preview-wikilink" data-wikilink-target="" data-wikilink-section="Heading">#Heading</span>',
    );
  });

  it("special chars in wikilink target are escaped in attribute", () => {
    const result = renderInlineMarkdown('[[Page<"q">]]');
    expect(result).toContain('data-wikilink-target="Page&lt;&quot;q&quot;&gt;"');
  });

  it("renders inline math", () => {
    const result = renderInlineMarkdown("$E=mc^2$");
    expect(result).toContain("cm-preview-math-inline");
    expect(result).toContain("E=mc^2");
  });

  it("renders inline math with \\(...\\) delimiters", () => {
    const result = renderInlineMarkdown("\\(x^2\\)");
    expect(result).toContain("cm-preview-math-inline");
    expect(result).toContain("x^2");
  });

  it("does not treat escaped opener \\\\(...\\) as math", () => {
    const result = renderInlineMarkdown("\\\\(not math\\)");
    expect(result).not.toContain("cm-preview-math");
  });

  it("math protects content from other transforms", () => {
    const result = renderInlineMarkdown("$**not bold**$");
    expect(result).not.toContain("<strong>");
    expect(result).toContain("cm-preview-math-inline");
  });

  it("handles mixed inline types in one string", () => {
    const result = renderInlineMarkdown("**bold** and *italic* and `code`");
    expect(result).toContain("<strong>bold</strong>");
    expect(result).toContain("<em>italic</em>");
    expect(result).toContain("<code>code</code>");
  });

  it("returns empty string for empty input", () => {
    expect(renderInlineMarkdown("")).toBe("");
  });

  it("renders raw latex placeholder when katex not loaded", () => {
    vi.mocked(getKatexSync).mockReturnValueOnce(null);
    const result = renderInlineMarkdown("$E=mc^2$");
    expect(result).toContain("cm-preview-math-placeholder");
    expect(result).toContain("E=mc^2");
    expect(result).not.toContain("katex");
  });

  it("renders underscore italic", () => {
    expect(renderInlineMarkdown("_italic_")).toBe("<em>italic</em>");
  });

  it("renders underscore bold", () => {
    expect(renderInlineMarkdown("__bold__")).toBe("<strong>bold</strong>");
  });

  it("preserves style attributes in KaTeX output after sanitization", () => {
    mockKatex.renderToString.mockReturnValueOnce(
      '<span class="katex" style="color:red;">E=mc^2</span>',
    );
    const result = renderInlineMarkdown("$E=mc^2$");
    expect(result).toContain("style=");
  });

  it("does not treat dollar amounts as math", () => {
    const result = renderInlineMarkdown("costs $10 and $20");
    expect(result).not.toContain("cm-preview-math");
    expect(result).toContain("$10");
    expect(result).toContain("$20");
  });

  it("does not treat spaced dollars as math", () => {
    const result = renderInlineMarkdown("$ not math $");
    expect(result).not.toContain("cm-preview-math");
  });

  it("does not treat escaped dollars as math", () => {
    const result = renderInlineMarkdown("\\$x\\$");
    expect(result).not.toContain("cm-preview-math");
  });

  it("renders escaped dollars as the fullwidth glyph", () => {
    const result = renderInlineMarkdown("The price is \\$5.");
    expect(result).toContain("\uFF04");
    expect(result).not.toContain("\\$");
    expect(result).not.toContain("cm-preview-math");
  });

  it("renders multiple escaped dollars in a cell", () => {
    const result = renderInlineMarkdown("\\$a and \\$b");
    expect(result.split("\uFF04")).toHaveLength(3);
  });

  it("does not turn \\\\$ (escaped backslash + bare dollar) into the stand-in", () => {
    const result = renderInlineMarkdown("\\\\$");
    expect(result).not.toContain("\uFF04");
    expect(result).toContain("$");
  });

  it("keeps \\$ literal inside code spans", () => {
    const result = renderInlineMarkdown("`\\$` code");
    expect(result).toContain("<code>\\$</code>");
    expect(result).not.toContain("\uFF04");
  });

  it("escaped dollar coexists with math in the same cell", () => {
    const result = renderInlineMarkdown("$E=mc^2$ costs \\$5");
    expect(result).toContain("cm-preview-math-inline");
    expect(result).toContain("\uFF04");
  });

  it("resolves escaped dollars in link URLs to ASCII $, keeps glyph in link text", () => {
    const result = renderInlineMarkdown("[pay \\$5](http://example.com/\\$5)");
    expect(result).toBe(
      '<a href="http://example.com/$5" class="cm-preview-link">pay \uFF045</a>',
    );
    expect(result).not.toContain("\\$");
  });
});

describe("serializeTable", () => {
  it("serializes basic table (headers + one row)", () => {
    expect(
      serializeTable({
        headers: ["h1", "h2"],
        alignments: ["default", "default"],
        rows: [["c1", "c2"]],
      }),
    ).toBe("| h1 | h2 |\n| --- | --- |\n| c1 | c2 |");
  });

  it("serializes multiple rows", () => {
    expect(
      serializeTable({
        headers: ["a"],
        alignments: ["default"],
        rows: [["r1"], ["r2"], ["r3"]],
      }),
    ).toBe("| a |\n| --- |\n| r1 |\n| r2 |\n| r3 |");
  });

  it("produces correct delimiters for all alignment types", () => {
    const result = serializeTable({
      headers: ["L", "R", "C", "D"],
      alignments: ["left", "right", "center", "default"],
      rows: [],
    });
    expect(result).toBe("| L | R | C | D |\n| :--- | ---: | :---: | --- |");
  });

  it("escapes pipe characters in cell content", () => {
    expect(
      serializeTable({
        headers: ["a|b"],
        alignments: ["default"],
        rows: [["x|y"]],
      }),
    ).toBe("| a\\|b |\n| --- |\n| x\\|y |");
  });

  it("handles empty cells", () => {
    expect(
      serializeTable({
        headers: ["h1", "h2"],
        alignments: ["default", "default"],
        rows: [["", ""]],
      }),
    ).toBe("| h1 | h2 |\n| --- | --- |\n|  |  |");
  });

  it("round-trip: parseTable(serializeTable(parsed)) preserves data", () => {
    const original = {
      headers: ["Name", "Value"],
      alignments: ["left" as const, "right" as const],
      rows: [
        ["alpha", "1"],
        ["beta", "2"],
      ],
    };
    const serialized = serializeTable(original);
    const reparsed = parseTable(serialized);
    expect(reparsed).not.toBeNull();
    expect(reparsed!.headers).toEqual(original.headers);
    expect(reparsed!.alignments).toEqual(original.alignments);
    expect(reparsed!.rows).toEqual(original.rows);
  });
});

describe("stripQuotePrefixes / applyQuotePrefixes", () => {
  it("plain table is an identity (empty prefixes)", () => {
    const raw = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const { text, prefixes } = stripQuotePrefixes(raw);
    expect(text).toBe(raw);
    expect(prefixes).toEqual(["", "", ""]);
    expect(applyQuotePrefixes(text, prefixes)).toBe(raw);
  });

  it("strips single-level '> ' prefixes so parseTable succeeds", () => {
    const raw = "| a | b |\n> | --- | --- |\n> | 1 | 2 |";
    const { text, prefixes } = stripQuotePrefixes(raw);
    expect(text).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
    expect(prefixes).toEqual(["", "> ", "> "]);
    expect(parseTable(text)).not.toBeNull();
  });

  it("captures bare '>' prefixes", () => {
    const raw = "| a |\n>| --- |\n>| 1 |";
    const { text, prefixes } = stripQuotePrefixes(raw);
    expect(text).toBe("| a |\n| --- |\n| 1 |");
    expect(prefixes).toEqual(["", ">", ">"]);
  });

  it("captures nested '> > ' prefixes", () => {
    const raw = "| a |\n> > | --- |\n> > | 1 |";
    const { text, prefixes } = stripQuotePrefixes(raw);
    expect(text).toBe("| a |\n| --- |\n| 1 |");
    expect(prefixes).toEqual(["", "> > ", "> > "]);
  });

  it("leaves unmarked lazy continuation lines unprefixed", () => {
    const raw = "| a |\n> | --- |\n| 1 |";
    const { text, prefixes } = stripQuotePrefixes(raw);
    expect(text).toBe("| a |\n| --- |\n| 1 |");
    expect(prefixes).toEqual(["", "> ", ""]);
    expect(applyQuotePrefixes(text, prefixes)).toBe(raw);
  });

  it("round-trips strip → parse → serialize → apply", () => {
    const raw = "| a | b |\n> | --- | --- |\n> | 1 | 2 |";
    const { text, prefixes } = stripQuotePrefixes(raw);
    const parsed = parseTable(text);
    expect(parsed).not.toBeNull();
    expect(applyQuotePrefixes(serializeTable(parsed!), prefixes)).toBe(raw);
  });

  it("reuses the last prefix when serialized has more lines than prefixes", () => {
    expect(applyQuotePrefixes("a\nb\nc", ["", "> "])).toBe("a\n> b\n> c");
  });
});

describe("getCellPosition", () => {
  const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";

  it("returns position of first header cell", () => {
    expect(getCellPosition(table, 0, 0, 0)).toBe(2);
  });

  it("returns position of second header cell", () => {
    expect(getCellPosition(table, 0, 0, 1)).toBe(6);
  });

  it("returns position of first body cell (skips delimiter)", () => {
    expect(getCellPosition(table, 0, 1, 0)).toBe(26);
  });

  it("returns position of second body cell", () => {
    expect(getCellPosition(table, 0, 1, 1)).toBe(30);
  });

  it("adds from offset", () => {
    expect(getCellPosition("| a |\n| --- |\n| x |", 100, 0, 0)).toBe(102);
  });

  it("handles table without leading pipes", () => {
    expect(getCellPosition("a | b\n---|---\n1 | 2", 0, 0, 0)).toBe(0);
  });

  it("handles second column without leading pipes", () => {
    expect(getCellPosition("a | b\n---|---\n1 | 2", 0, 0, 1)).toBe(4);
  });

  it("skips leading whitespace after pipe", () => {
    expect(getCellPosition("|  hello  |  world  |\n| --- | --- |", 0, 0, 0)).toBe(3);
  });

  it("positions cursor in empty cell at pipe+1", () => {
    expect(getCellPosition("| a |  |\n| --- | --- |", 0, 0, 1)).toBe(5);
  });

  it("handles multiple body rows", () => {
    expect(getCellPosition("| h |\n| --- |\n| r1 |\n| r2 |", 0, 2, 0)).toBe(23);
  });

  it("handles from offset with body cell", () => {
    expect(getCellPosition("| a |\n| --- |\n| x |", 50, 1, 0)).toBe(66);
  });
});
