import { describe, it, expect } from "vitest";
import { extractHeadings } from "./headings";

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

});
