import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { getStyleTags, tags } from "@lezer/highlight";
import { Footnote } from "./footnote";

function parseNodes(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Footnote] })],
  });
  const nodes: { name: string; from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

describe("Footnote inline parser — FootnoteRef", () => {
  it("parses [^1] as FootnoteRef", () => {
    const nodes = parseNodes("See [^1] here.");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeDefined();
    expect(ref!.from).toBe(4);
    expect(ref!.to).toBe(8);
  });

  it("creates FootnoteRefMark children for [^ and ]", () => {
    const nodes = parseNodes("See [^1] here.");
    const marks = nodes.filter((n) => n.name === "FootnoteRefMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]!.from).toBe(4);
    expect(marks[0]!.to).toBe(6);
    expect(marks[1]!.from).toBe(7);
    expect(marks[1]!.to).toBe(8);
  });

  it("parses [^abc] with alpha identifier", () => {
    const nodes = parseNodes("Text [^abc] end.");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeDefined();
    expect(ref!.from).toBe(5);
    expect(ref!.to).toBe(11);
  });

  it("parses [^my-note-1] with hyphens and digits", () => {
    const nodes = parseNodes("[^my-note-1]");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeDefined();
    expect(ref!.from).toBe(0);
    expect(ref!.to).toBe(12);
  });

  it("parses [^A_B] with underscores", () => {
    const nodes = parseNodes("[^A_B]");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeDefined();
  });

  it("rejects [^] (empty identifier)", () => {
    const nodes = parseNodes("[^]");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeUndefined();
  });

  it("rejects [^ space] (space in identifier)", () => {
    const nodes = parseNodes("[^ space]");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeUndefined();
  });

  it("rejects [^unclosed (no closing bracket)", () => {
    const nodes = parseNodes("[^unclosed");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeUndefined();
  });

  it("rejects [^multi\\nline] (newline in identifier)", () => {
    const nodes = parseNodes("[^multi\nline]");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeUndefined();
  });

  it("rejects [not a ref] (no caret)", () => {
    const nodes = parseNodes("[not a ref]");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeUndefined();
  });

  it("parses at start of line", () => {
    const nodes = parseNodes("[^1] begins the line.");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeDefined();
    expect(ref!.from).toBe(0);
  });

  it("parses at end of line", () => {
    const nodes = parseNodes("End ref[^1]");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeDefined();
    expect(ref!.to).toBe(11);
  });

  it("parses inside emphasis", () => {
    const nodes = parseNodes("*text[^1]*");
    const ref = nodes.find((n) => n.name === "FootnoteRef");
    expect(ref).toBeDefined();
  });

  it("parses multiple refs in same line", () => {
    const nodes = parseNodes("See [^1] and [^2] here.");
    const refs = nodes.filter((n) => n.name === "FootnoteRef");
    expect(refs).toHaveLength(2);
  });
});

describe("Footnote block parser — FootnoteDef", () => {
  it("parses single-line definition", () => {
    const nodes = parseNodes("[^1]: Definition text");
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
    expect(def!.from).toBe(0);
    expect(def!.to).toBe(21);
  });

  it("creates FootnoteDefMark child for [^1]:", () => {
    const nodes = parseNodes("[^1]: Definition text");
    const mark = nodes.find((n) => n.name === "FootnoteDefMark");
    expect(mark).toBeDefined();
    expect(mark!.from).toBe(0);
    expect(mark!.to).toBe(5);
  });

  it("parses multi-line definition with 4-space continuation", () => {
    const doc = "[^1]: First line\n    Continuation line";
    const nodes = parseNodes(doc);
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
    expect(def!.from).toBe(0);
    expect(def!.to).toBe(doc.length);
  });

  it("stops at non-indented line", () => {
    const doc = "[^1]: Definition\nNot continuation";
    const nodes = parseNodes(doc);
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
    expect(def!.to).toBe(16);
  });

  it("does not absorb trailing blanks before a non-indented paragraph", () => {
    const doc = "[^1]: Definition\n\nNext paragraph";
    const nodes = parseNodes(doc);
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
    // End of "Definition" - unchanged; the blank + paragraph stay outside.
    expect(def!.to).toBe(16);
    expect(nodes.some((n) => n.name === "Paragraph" && doc.slice(n.from, n.to) === "Next paragraph")).toBe(true);
  });

  it("absorbs blank lines between the marker line and indented continuations", () => {
    const doc = "[^1]: Title\n\n    Body after blank";
    const nodes = parseNodes(doc);
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
    expect(def!.from).toBe(0);
    expect(def!.to).toBe(doc.length);
    expect(doc.slice(def!.from, def!.to)).toContain("Body after blank");
  });

  it("keeps multi-paragraph indented body with blanks inside one FootnoteDef", () => {
    const doc = [
      "[^1]: **Title**",
      "",
      "    First paragraph with $x$",
      "",
      "    ### Setup",
      "",
      "    $$",
      "    E = mc^2",
      "    $$",
    ].join("\n");
    const nodes = parseNodes(doc);
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
    expect(def!.to).toBe(doc.length);
    expect(doc.slice(def!.from, def!.to)).toContain("### Setup");
  });

  it("parses two consecutive definitions as separate nodes", () => {
    const doc = "[^1]: First\n[^2]: Second";
    const nodes = parseNodes(doc);
    const defs = nodes.filter((n) => n.name === "FootnoteDef");
    expect(defs).toHaveLength(2);
  });

  it("parses empty definition text", () => {
    const doc = "[^1]:";
    const nodes = parseNodes(doc);
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
  });

  it("parses tab-indented continuation", () => {
    const doc = "[^1]: First line\n\tContinuation line";
    const nodes = parseNodes(doc);
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
    expect(def!.to).toBe(doc.length);
  });

  it("does not conflict with standard links", () => {
    const doc = "[text](url)\n\n[^1]: Footnote";
    const nodes = parseNodes(doc);
    const link = nodes.find((n) => n.name === "Link");
    expect(link).toBeDefined();
    const def = nodes.find((n) => n.name === "FootnoteDef");
    expect(def).toBeDefined();
  });
});

describe("Footnote highlight tags", () => {
  // Regression lock for #1001: FootnoteDef must NOT paint as .tok-link
  // (accent + underline) when the raw source is revealed by the caret.
  // The mark keeps chrome (processingInstruction) and refs keep tags.link.
  // If `style: tags.link` is ever re-added to FootnoteDef in defineNodes,
  // this suite fails.
  function parseHighlightTags(
    doc: string,
  ): Map<string, ReturnType<typeof getStyleTags>> {
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: [Footnote] })],
    });
    const tagsByNode = new Map<string, ReturnType<typeof getStyleTags>>();
    syntaxTree(state).iterate({
      enter: (node) => {
        if (!tagsByNode.has(node.name)) {
          tagsByNode.set(node.name, getStyleTags(node));
        }
      },
    });
    return tagsByNode;
  }

  it("FootnoteDef has no highlight rule (must not be tags.link)", () => {
    const tagsByNode = parseHighlightTags("See [^1].\n\n[^1]: Def text");
    // The key must exist (node parsed) and carry no style rule at all.
    expect(tagsByNode.has("FootnoteDef")).toBe(true);
    expect(tagsByNode.get("FootnoteDef")).toBeNull();
  });

  it("FootnoteRef keeps tags.link (positive control)", () => {
    const tagsByNode = parseHighlightTags("See [^1].\n\n[^1]: Def text");
    expect(tagsByNode.get("FootnoteRef")?.tags).toContain(tags.link);
  });

  it("FootnoteDefMark keeps tags.processingInstruction (chrome stays on the mark)", () => {
    const tagsByNode = parseHighlightTags("See [^1].\n\n[^1]: Def text");
    expect(tagsByNode.get("FootnoteDefMark")?.tags).toContain(tags.processingInstruction);
  });
});
