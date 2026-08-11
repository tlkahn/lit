import { describe, it, expect } from "vitest";
import {
  ESCAPED_DOLLAR_GLYPH,
  ESCAPED_DOLLAR_HTML_CLASS,
  replaceEscapedDollars,
  replaceEscapedDollarsHtml,
} from "./escapedDollar";

describe("replaceEscapedDollars", () => {
  it("replaces a single \\$ escape", () => {
    expect(replaceEscapedDollars("\\$5")).toBe(`${ESCAPED_DOLLAR_GLYPH}5`);
  });

  it("replaces escaped dollars mid-sentence", () => {
    expect(replaceEscapedDollars("The price is \\$5.")).toBe(
      `The price is ${ESCAPED_DOLLAR_GLYPH}5.`,
    );
  });

  it("leaves \\\\$ (escaped backslash + bare dollar) unchanged", () => {
    expect(replaceEscapedDollars("\\\\$")).toBe("\\\\$");
  });

  it("replaces the dollar in \\\\\\$ but keeps the escaped backslash", () => {
    // "\\\" (3 backslashes) + "$": escape is "\\" (backslash) + "\$" (dollar)
    expect(replaceEscapedDollars("\\\\\\$")).toBe(`\\\\${ESCAPED_DOLLAR_GLYPH}`);
  });

  it("replaces multiple escaped dollars", () => {
    expect(replaceEscapedDollars("\\$a \\$b")).toBe(
      `${ESCAPED_DOLLAR_GLYPH}a ${ESCAPED_DOLLAR_GLYPH}b`,
    );
  });

  it("returns empty string unchanged", () => {
    expect(replaceEscapedDollars("")).toBe("");
  });

  it("leaves strings without escapes unchanged", () => {
    expect(replaceEscapedDollars("plain text")).toBe("plain text");
  });

  it("does not touch dollar pairs without a backslash", () => {
    expect(replaceEscapedDollars("$x$ and $10")).toBe("$x$ and $10");
  });

  it("does not touch other escapes", () => {
    expect(replaceEscapedDollars("\\* \\[ \\\\")).toBe("\\* \\[ \\\\");
  });
});

describe("replaceEscapedDollarsHtml", () => {
  it("wraps the glyph in a span with the html class", () => {
    expect(replaceEscapedDollarsHtml("\\$5")).toBe(
      `<span class="${ESCAPED_DOLLAR_HTML_CLASS}">${ESCAPED_DOLLAR_GLYPH}</span>5`,
    );
  });

  it("preserves backslash runs before the replacement", () => {
    expect(replaceEscapedDollarsHtml("\\\\\\$")).toBe(
      `\\\\<span class="${ESCAPED_DOLLAR_HTML_CLASS}">${ESCAPED_DOLLAR_GLYPH}</span>`,
    );
  });

  it("leaves \\\\$ (escaped backslash + bare dollar) unchanged", () => {
    expect(replaceEscapedDollarsHtml("\\\\$")).toBe("\\\\$");
  });

  it("wraps multiple escaped dollars", () => {
    const wrapped = `<span class="${ESCAPED_DOLLAR_HTML_CLASS}">${ESCAPED_DOLLAR_GLYPH}</span>`;
    expect(replaceEscapedDollarsHtml("\\$a \\$b")).toBe(`${wrapped}a ${wrapped}b`);
  });

  it("leaves plain text unchanged", () => {
    expect(replaceEscapedDollarsHtml("plain")).toBe("plain");
  });
});
