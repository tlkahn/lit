import { describe, it, expect } from "vitest";
import { extractBlockAnchors, findBlockAnchor } from "./blockAnchors";

describe("extractBlockAnchors", () => {
  it("extracts trailing-form anchor with marker range", () => {
    const body = "Some text ^abc";
    const anchors = extractBlockAnchors(body);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.id).toBe("abc");
    expect(anchors[0]!.line).toBe(0);
    expect(body.slice(anchors[0]!.from, anchors[0]!.to)).toBe("^abc");
  });

  it("extracts standalone-line anchor after a table", () => {
    const body = "| a | b |\n| - | - |\n| 1 | 2 |\n^tbl-1";
    const anchors = extractBlockAnchors(body);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.id).toBe("tbl-1");
    expect(anchors[0]!.line).toBe(3);
    expect(body.slice(anchors[0]!.from, anchors[0]!.to)).toBe("^tbl-1");
  });

  it("allows hyphenated ids", () => {
    const body = "paragraph text ^my-block-1";
    const anchors = extractBlockAnchors(body);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.id).toBe("my-block-1");
    expect(body.slice(anchors[0]!.from, anchors[0]!.to)).toBe("^my-block-1");
  });

  it("computes offsets across multiple lines", () => {
    const body = "first line ^one\nplain\nlast ^two";
    const anchors = extractBlockAnchors(body);
    expect(anchors).toHaveLength(2);
    expect(anchors[0]!.line).toBe(0);
    expect(anchors[1]!.line).toBe(2);
    expect(body.slice(anchors[0]!.from, anchors[0]!.to)).toBe("^one");
    expect(body.slice(anchors[1]!.from, anchors[1]!.to)).toBe("^two");
  });

  it("tolerates trailing spaces after the id", () => {
    const body = "text ^abc  ";
    const anchors = extractBlockAnchors(body);
    expect(anchors).toHaveLength(1);
    expect(body.slice(anchors[0]!.from, anchors[0]!.to)).toBe("^abc");
  });

  it("ignores mid-line anchors", () => {
    expect(extractBlockAnchors("text ^abc more text")).toEqual([]);
  });

  it("ignores caret without leading whitespace", () => {
    expect(extractBlockAnchors("foo^abc")).toEqual([]);
  });

  it("ignores escaped caret", () => {
    expect(extractBlockAnchors("text \\^abc")).toEqual([]);
  });

  it("ignores invalid id characters", () => {
    expect(extractBlockAnchors("text ^ab_cd")).toEqual([]);
  });

  it("ignores bare caret", () => {
    expect(extractBlockAnchors("text ^")).toEqual([]);
  });

  it("ignores inline-code-wrapped anchor", () => {
    expect(extractBlockAnchors("text `^abc`")).toEqual([]);
  });

  it("skips fenced code lines", () => {
    const body = "```\ncode ^abc\n```\nreal text ^def";
    const anchors = extractBlockAnchors(body);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]!.id).toBe("def");
    expect(anchors[0]!.line).toBe(3);
    expect(body.slice(anchors[0]!.from, anchors[0]!.to)).toBe("^def");
  });

  it("returns empty for empty body", () => {
    expect(extractBlockAnchors("")).toEqual([]);
  });
});

describe("findBlockAnchor", () => {
  const body = "First block. ^3141e2\n\nSecond block. ^other";

  it("finds anchor by exact id", () => {
    const anchor = findBlockAnchor(body, "3141e2");
    expect(anchor).not.toBeNull();
    expect(anchor!.id).toBe("3141e2");
    expect(anchor!.line).toBe(0);
  });

  it("matches case-insensitively, preserving original id", () => {
    const anchor = findBlockAnchor(body, "3141E2");
    expect(anchor).not.toBeNull();
    expect(anchor!.id).toBe("3141e2");
  });

  it("returns null when absent", () => {
    expect(findBlockAnchor(body, "missing")).toBeNull();
  });
});
