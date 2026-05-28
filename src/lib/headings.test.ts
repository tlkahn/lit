import { describe, it, expect } from "vitest";
import { extractHeadings, stripInlineMarkdown } from "./headings";

describe("extractHeadings", () => {
  it("returns [] for empty string", () => {
    expect(extractHeadings("")).toEqual([]);
  });

  it("returns [] when no headings", () => {
    expect(extractHeadings("just some text\nand more text")).toEqual([]);
  });

  it("parses single # Title", () => {
    expect(extractHeadings("# Title")).toEqual([
      { level: 1, text: "Title", line: 0, from: 0, to: 7 },
    ]);
  });

  it("parses multiple headings at different levels with correct line numbers", () => {
    const body = "# One\nsome text\n## Two\n### Three";
    expect(extractHeadings(body)).toEqual([
      { level: 1, text: "One", line: 0, from: 0, to: 5 },
      { level: 2, text: "Two", line: 2, from: 16, to: 22 },
      { level: 3, text: "Three", line: 3, from: 23, to: 32 },
    ]);
  });

  it("strips whitespace from heading text", () => {
    expect(extractHeadings("#   Spaced  ")).toEqual([
      { level: 1, text: "Spaced", line: 0, from: 0, to: 12 },
    ]);
  });

  it("handles H1 through H6", () => {
    const body = Array.from({ length: 6 }, (_, i) => `${"#".repeat(i + 1)} H${i + 1}`).join("\n");
    const result = extractHeadings(body);
    expect(result).toHaveLength(6);
    let expectedFrom = 0;
    for (let i = 0; i < 6; i++) {
      const lineLen = (i + 1) + 3;
      expect(result[i]).toEqual({ level: i + 1, text: `H${i + 1}`, line: i, from: expectedFrom, to: expectedFrom + lineLen });
      expectedFrom += lineLen + 1;
    }
  });

  it("ignores 7+ hashes", () => {
    expect(extractHeadings("####### Not a heading")).toEqual([]);
  });

  it("ignores #hashtag (no space after hashes)", () => {
    expect(extractHeadings("#hashtag")).toEqual([]);
  });

  it("skips headings inside fenced code blocks", () => {
    const body = "# Real\n```\n# Fake\n```\n## Also Real";
    expect(extractHeadings(body)).toEqual([
      { level: 1, text: "Real", line: 0, from: 0, to: 6 },
      { level: 2, text: "Also Real", line: 4, from: 22, to: 34 },
    ]);
  });

  it("skips headings inside fenced code blocks with language tag", () => {
    const body = "```markdown\n# Inside fence\n```\n# Outside";
    expect(extractHeadings(body)).toEqual([
      { level: 1, text: "Outside", line: 3, from: 31, to: 40 },
    ]);
  });

  it("handles unclosed fence conservatively (skips everything after)", () => {
    const body = "# Before\n```\n# Inside\n# Also inside";
    expect(extractHeadings(body)).toEqual([
      { level: 1, text: "Before", line: 0, from: 0, to: 8 },
    ]);
  });

  it("handles tilde fences", () => {
    const body = "# Real\n~~~\n# Fake\n~~~\n## Also Real";
    expect(extractHeadings(body)).toEqual([
      { level: 1, text: "Real", line: 0, from: 0, to: 6 },
      { level: 2, text: "Also Real", line: 4, from: 22, to: 34 },
    ]);
  });

  it("returns from/to character offsets for each heading", () => {
    const body = "# One\nsome text\n## Two\n### Three";
    const headings = extractHeadings(body);
    expect(headings).toEqual([
      { level: 1, text: "One", line: 0, from: 0, to: 5 },
      { level: 2, text: "Two", line: 2, from: 16, to: 22 },
      { level: 3, text: "Three", line: 3, from: 23, to: 32 },
    ]);
  });

  it("strips inline markdown from heading text", () => {
    expect(extractHeadings("## **Bold** and [link](url)")).toEqual([
      { level: 2, text: "Bold and link", line: 0, from: 0, to: 27 },
    ]);
  });

});

describe("stripInlineMarkdown", () => {
  it("strips bold **", () => {
    expect(stripInlineMarkdown("**bold**")).toBe("bold");
  });

  it("strips bold __", () => {
    expect(stripInlineMarkdown("__bold__")).toBe("bold");
  });

  it("strips italic *", () => {
    expect(stripInlineMarkdown("*italic*")).toBe("italic");
  });

  it("strips italic _", () => {
    expect(stripInlineMarkdown("_italic_")).toBe("italic");
  });

  it("strips inline code", () => {
    expect(stripInlineMarkdown("`code`")).toBe("code");
  });

  it("strips links", () => {
    expect(stripInlineMarkdown("[text](url)")).toBe("text");
  });

  it("strips images", () => {
    expect(stripInlineMarkdown("![alt](img)")).toBe("alt");
  });

  it("strips strikethrough", () => {
    expect(stripInlineMarkdown("~~strike~~")).toBe("strike");
  });

  it("strips highlight", () => {
    expect(stripInlineMarkdown("==highlight==")).toBe("highlight");
  });

  it("strips plain wikilinks", () => {
    expect(stripInlineMarkdown("[[wikilink]]")).toBe("wikilink");
  });

  it("strips aliased wikilinks using alias", () => {
    expect(stripInlineMarkdown("[[target|alias]]")).toBe("alias");
  });

  it("leaves plain text unchanged", () => {
    expect(stripInlineMarkdown("plain text")).toBe("plain text");
  });

  it("strips mixed formatting", () => {
    expect(stripInlineMarkdown("**bold** and *italic*")).toBe("bold and italic");
  });

  it("strips nested formatting", () => {
    expect(stripInlineMarkdown("**_bold italic_**")).toBe("bold italic");
  });
});
