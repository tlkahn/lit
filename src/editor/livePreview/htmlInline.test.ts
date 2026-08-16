import { describe, it, expect } from "vitest";
import {
  parseHtmlInlineTag,
  pairHtmlInlineTags,
  HTML_INLINE_ALLOWLIST,
  HTML_INLINE_PAIR_CLASS,
  type HtmlTagSpan,
} from "./htmlInline";

describe("parseHtmlInlineTag", () => {
  it("parses bare <sup> as open sup", () => {
    expect(parseHtmlInlineTag("<sup>")).toEqual({ kind: "open", name: "sup", bare: true });
  });

  it("parses bare </sup> as close sup", () => {
    expect(parseHtmlInlineTag("</sup>")).toEqual({ kind: "close", name: "sup", bare: true });
  });

  it("parses bare <sub> and </sub>", () => {
    expect(parseHtmlInlineTag("<sub>")).toEqual({ kind: "open", name: "sub", bare: true });
    expect(parseHtmlInlineTag("</sub>")).toEqual({ kind: "close", name: "sub", bare: true });
  });

  it("parses bare <mark> and </mark>", () => {
    expect(parseHtmlInlineTag("<mark>")).toEqual({ kind: "open", name: "mark", bare: true });
    expect(parseHtmlInlineTag("</mark>")).toEqual({ kind: "close", name: "mark", bare: true });
  });

  it("is case-insensitive", () => {
    expect(parseHtmlInlineTag("<SUP>")).toEqual({ kind: "open", name: "sup", bare: true });
    expect(parseHtmlInlineTag("</Sup>")).toEqual({ kind: "close", name: "sup", bare: true });
    expect(parseHtmlInlineTag("<Br/>")).toEqual({ kind: "void", name: "br", bare: true });
  });

  it("parses void <br> forms", () => {
    expect(parseHtmlInlineTag("<br>")).toEqual({ kind: "void", name: "br", bare: true });
    expect(parseHtmlInlineTag("<br/>")).toEqual({ kind: "void", name: "br", bare: true });
    expect(parseHtmlInlineTag("<br />")).toEqual({ kind: "void", name: "br", bare: true });
  });

  it("accepts whitespace inside the tag when lezer emits it", () => {
    expect(parseHtmlInlineTag("< sup >")).toEqual({ kind: "open", name: "sup", bare: true });
    expect(parseHtmlInlineTag("</ sup >")).toEqual({ kind: "close", name: "sup", bare: true });
    expect(parseHtmlInlineTag("<br >")).toEqual({ kind: "void", name: "br", bare: true });
  });

  it("rejects attributed allowlist tags as other", () => {
    expect(parseHtmlInlineTag('<sup id="x">')).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag('<sup class="a">')).toEqual({ kind: "other" });
  });

  it("rejects non-allowlist tags as other", () => {
    expect(parseHtmlInlineTag("<span>")).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag("</span>")).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag("<em>")).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag("<b>")).toEqual({ kind: "other" });
  });

  it("rejects garbage / empty as other", () => {
    expect(parseHtmlInlineTag("")).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag("<sup")).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag("sup>")).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag("plain text")).toEqual({ kind: "other" });
    expect(parseHtmlInlineTag("<<sup>>")).toEqual({ kind: "other" });
  });

  it("rejects close <br> forms (br is void only)", () => {
    expect(parseHtmlInlineTag("</br>")).toEqual({ kind: "other" });
  });
});

function span(raw: string): HtmlTagSpan {
  return { from: 0, to: raw.length, raw, parentFrom: 0 };
}

function tags<T extends string[]>(...raws: T): { [K in keyof T]: HtmlTagSpan } {
  let pos = 0;
  return raws.map((raw) => {
    const s = { from: pos, to: pos + raw.length, raw, parentFrom: 0 };
    pos += raw.length;
    return s;
  }) as { [K in keyof T]: HtmlTagSpan };
}

// Same as tags() but each span carries an explicit parentFrom (document
// position of the direct syntax parent node). Used to pin the same-parent
// fail-closed pairing rule.
function tagsWithParent<T extends { raw: string; parentFrom: number }[]>(
  ...items: T
): { [K in keyof T]: HtmlTagSpan } {
  let pos = 0;
  return items.map(({ raw, parentFrom }) => {
    const s = { from: pos, to: pos + raw.length, raw, parentFrom };
    pos += raw.length;
    return s;
  }) as { [K in keyof T]: HtmlTagSpan };
}

describe("pairHtmlInlineTags", () => {
  it("pairs a single sup open/close", () => {
    const [open, close] = tags("<sup>", "</sup>");
    expect(pairHtmlInlineTags([open, close])).toEqual([
      {
        type: "pair",
        name: "sup",
        open,
        close,
        contentFrom: open.to,
        contentTo: close.from,
      },
    ]);
  });

  it("pairs a single sub open/close", () => {
    const [open, close] = tags("<sub>", "</sub>");
    expect(pairHtmlInlineTags([open, close])).toEqual([
      {
        type: "pair",
        name: "sub",
        open,
        close,
        contentFrom: open.to,
        contentTo: close.from,
      },
    ]);
  });

  it("nested sup > sub yields both pairs", () => {
    const [s1, s2, c2, c1] = tags("<sup>", "<sub>", "</sub>", "</sup>");
    expect(pairHtmlInlineTags([s1, s2, c2, c1])).toEqual([
      {
        type: "pair",
        name: "sub",
        open: s2,
        close: c2,
        contentFrom: s2.to,
        contentTo: c2.from,
      },
      {
        type: "pair",
        name: "sup",
        open: s1,
        close: c1,
        contentFrom: s1.to,
        contentTo: c1.from,
      },
    ]);
  });

  it("lists a lone void br", () => {
    const [br] = tags("<br>");
    expect(pairHtmlInlineTags([br])).toEqual([{ type: "void", name: "br", tag: br }]);
  });

  it("unclosed open produces no pair", () => {
    const [open] = tags("<sup>");
    expect(pairHtmlInlineTags([open])).toEqual([]);
  });

  it("orphan close produces no pair", () => {
    const [close] = tags("</sup>");
    expect(pairHtmlInlineTags([close])).toEqual([]);
  });

  it("mismatched close (<sup></sub>) produces no pair", () => {
    expect(pairHtmlInlineTags(tags("<sup>", "</sub>"))).toEqual([]);
  });

  it("attributed open + bare close produces no pair (open is other)", () => {
    expect(pairHtmlInlineTags(tags('<sup id="x">', "</sup>"))).toEqual([]);
  });

  it("two sequential sup pairs both listed", () => {
    const [o1, c1, o2, c2] = tags("<sup>", "</sup>", "<sup>", "</sup>");
    const pairs = pairHtmlInlineTags([o1, c1, o2, c2]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toMatchObject({ type: "pair", name: "sup", open: o1, close: c1 });
    expect(pairs[1]).toMatchObject({ type: "pair", name: "sup", open: o2, close: c2 });
  });

  it("ignores other tags between a valid pair", () => {
    const [open, spanOpen, spanClose, close] = tags("<sup>", "<span>", "</span>", "</sup>");
    expect(pairHtmlInlineTags([open, spanOpen, spanClose, close])).toEqual([
      {
        type: "pair",
        name: "sup",
        open,
        close,
        contentFrom: open.to,
        contentTo: close.from,
      },
    ]);
  });

  it("empty list produces no pairs", () => {
    expect(pairHtmlInlineTags([])).toEqual([]);
  });

  it("void br inside a pair does not disturb pairing", () => {
    const [open, br, close] = tags("<sup>", "<br>", "</sup>");
    const pairs = pairHtmlInlineTags([open, br, close]);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]).toEqual({ type: "void", name: "br", tag: br });
    expect(pairs[1]).toMatchObject({ type: "pair", name: "sup", open, close });
  });

  it("interleaved mismatched close fails closed without popping unrelated opens", () => {
    // <sup> then </sub> then </sup>: the orphan </sub> is ignored, the later
    // </sup> still closes the <sup> (stack unchanged by the mismatch).
    const [o, orphan, c] = tags("<sup>", "</sub>", "</sup>");
    const pairs = pairHtmlInlineTags([o, orphan, c]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ type: "pair", name: "sup", open: o, close: c });
  });

  it("pairs across different parentFrom values are dropped", () => {
    const [open, close] = tagsWithParent(
      { raw: "<sup>", parentFrom: 0 },
      { raw: "</sup>", parentFrom: 10 },
    );
    expect(pairHtmlInlineTags([open, close])).toEqual([]);
  });

  it("missing parentFrom (-1) never pairs", () => {
    const [open, close] = tagsWithParent(
      { raw: "<sup>", parentFrom: -1 },
      { raw: "</sup>", parentFrom: -1 },
    );
    expect(pairHtmlInlineTags([open, close])).toEqual([]);
  });

  it("nested open under a different parent than its close fails closed", () => {
    const [s1, s2, c2, c1] = tagsWithParent(
      { raw: "<sup>", parentFrom: 0 },
      { raw: "<sub>", parentFrom: 0 },
      { raw: "</sub>", parentFrom: 10 },
      { raw: "</sup>", parentFrom: 0 },
    );
    // The parent-mismatched </sub> is ignored without popping, so the outer
    // </sup> cannot reach the still-stacked <sub> -> fail closed entirely.
    expect(pairHtmlInlineTags([s1, s2, c2, c1])).toEqual([]);
  });

  it("parent-mismatched close fails closed without popping unrelated opens", () => {
    // <sup> (parent 0), then a parent-mismatched </sup> (parent 10) that is
    // ignored, then a same-parent </sup> (parent 0) still closes the open.
    const [o, orphan, c] = tagsWithParent(
      { raw: "<sup>", parentFrom: 0 },
      { raw: "</sup>", parentFrom: 10 },
      { raw: "</sup>", parentFrom: 0 },
    );
    const pairs = pairHtmlInlineTags([o!, orphan!, c!]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ type: "pair", name: "sup", open: o, close: c });
  });

  it("helper: span()/tags() positions are document-ordered", () => {
    const t = tags("<sup>", "x", "</sup>");
    expect(t[0]!.from).toBe(0);
    expect(t[1]!.from).toBe(5);
    expect(t[2]!.from).toBe(6);
    expect(span("<sup>")).toEqual({ from: 0, to: 5, raw: "<sup>", parentFrom: 0 });
  });
});

describe("HTML_INLINE_ALLOWLIST / HTML_INLINE_PAIR_CLASS sync", () => {
  it("every allowlisted pair tag has a class map entry and br does not", () => {
    for (const name of HTML_INLINE_ALLOWLIST) {
      const cls = (HTML_INLINE_PAIR_CLASS as Record<string, string | undefined>)[name];
      if (name === "br") {
        expect(cls).toBeUndefined();
      } else {
        expect(cls).toMatch(/^cm-preview-/);
      }
    }
  });
});
