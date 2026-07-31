import { describe, it, expect } from "vitest";
import { blockquote } from "./blockquote";

describe("blockquote", () => {
  it("prefixes a single line with '> '", () => {
    expect(blockquote("hello world")).toBe("> hello world");
  });

  it("prefixes every line", () => {
    expect(blockquote("one\ntwo\nthree")).toBe("> one\n> two\n> three");
  });

  it("turns a blank interior line into '> '", () => {
    expect(blockquote("a\n\nb")).toBe("> a\n> \n> b");
  });

  it("drops a single trailing newline (Rust str::lines parity)", () => {
    expect(blockquote("a\n")).toBe("> a");
    expect(blockquote("a\n\n")).toBe("> a\n> ");
  });

  it("normalizes CRLF line endings", () => {
    expect(blockquote("a\r\nb\r\n")).toBe("> a\n> b");
  });

  it("returns empty for empty input", () => {
    expect(blockquote("")).toBe("");
  });
});
