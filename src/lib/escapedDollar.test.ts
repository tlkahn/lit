import { describe, it, expect } from "vitest";
import {
  ESCAPED_DOLLAR_GLYPH,
  ESCAPED_DOLLAR_HTML_CLASS,
  ESCAPED_DOLLAR_PLACEHOLDER,
  replaceEscapedDollars,
  maskEscapedDollars,
  restoreEscapedDollarsInHtml,
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

describe("maskEscapedDollars", () => {
  it("substitutes the placeholder for a single \\$ escape", () => {
    expect(maskEscapedDollars("\\$5")).toBe(`${ESCAPED_DOLLAR_PLACEHOLDER}5`);
  });

  it("preserves backslash runs before the placeholder", () => {
    expect(maskEscapedDollars("\\\\\\$")).toBe(
      `\\\\${ESCAPED_DOLLAR_PLACEHOLDER}`,
    );
  });

  it("leaves \\\\$ (escaped backslash + bare dollar) unchanged", () => {
    expect(maskEscapedDollars("\\\\$")).toBe("\\\\$");
  });

  it("leaves plain text and non-dollar escapes unchanged", () => {
    expect(maskEscapedDollars("plain \\* \\[")).toBe("plain \\* \\[");
  });

  it("never emits a dollar or HTML in the placeholder", () => {
    const masked = maskEscapedDollars("\\$5");
    expect(masked).not.toContain("$");
    expect(masked).not.toContain("<");
    expect(masked).not.toContain(">");
  });
});

describe("restoreEscapedDollarsInHtml", () => {
  it("wraps the glyph in a span in text nodes", () => {
    const html = `<p>price ${ESCAPED_DOLLAR_PLACEHOLDER}5</p>`;
    expect(restoreEscapedDollarsInHtml(html)).toBe(
      `<p>price <span class="${ESCAPED_DOLLAR_HTML_CLASS}">${ESCAPED_DOLLAR_GLYPH}</span>5</p>`,
    );
  });

  it("restores ASCII $ in attributes (raw placeholder form)", () => {
    const html = `<span title="costs ${ESCAPED_DOLLAR_PLACEHOLDER}5">hi</span>`;
    expect(restoreEscapedDollarsInHtml(html)).toBe(
      `<span title="costs $5">hi</span>`,
    );
  });

  it("restores ASCII $ in percent-encoded destinations (marked href form)", () => {
    const encoded = encodeURIComponent(ESCAPED_DOLLAR_PLACEHOLDER);
    const html = `<a href="http://e.com/${encoded}5">x</a>`;
    expect(restoreEscapedDollarsInHtml(html)).toBe(
      `<a href="http://e.com/$5">x</a>`,
    );
  });

  it("leaves CODE/PRE text nodes untouched", () => {
    const html = `<pre><code>\\$${ESCAPED_DOLLAR_PLACEHOLDER}5</code></pre>`;
    expect(restoreEscapedDollarsInHtml(html)).toBe(html);
  });

  it("returns input unchanged when no placeholder is present", () => {
    expect(restoreEscapedDollarsInHtml("<p>plain</p>")).toBe("<p>plain</p>");
  });

  it("handles multiple placeholders in one text node", () => {
    const html = `<p>${ESCAPED_DOLLAR_PLACEHOLDER}a ${ESCAPED_DOLLAR_PLACEHOLDER}b</p>`;
    const result = restoreEscapedDollarsInHtml(html);
    expect(result.split(ESCAPED_DOLLAR_GLYPH)).toHaveLength(3);
  });
});

