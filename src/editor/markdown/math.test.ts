import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { Math } from "./math";

function parseNodes(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Math] })],
  });
  const nodes: { name: string; from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

describe("InlineMath parser", () => {
  it("parses $E=mc^2$ as InlineMath", () => {
    const nodes = parseNodes("$E=mc^2$");
    const im = nodes.find((n) => n.name === "InlineMath");
    expect(im).toBeDefined();
    expect(im!.from).toBe(0);
    expect(im!.to).toBe(8);
  });

  it("produces InlineMathMark children", () => {
    const nodes = parseNodes("$E=mc^2$");
    const marks = nodes.filter((n) => n.name === "InlineMathMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "InlineMathMark", from: 0, to: 1 });
    expect(marks[1]).toEqual({ name: "InlineMathMark", from: 7, to: 8 });
  });

  it("does not match single $ without closing", () => {
    const nodes = parseNodes("$unclosed");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });

  it("$$ does not match as inline math", () => {
    const nodes = parseNodes("$$notinline$$");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });

  it("$a + b$ with spaces works", () => {
    const nodes = parseNodes("$a + b$");
    const im = nodes.find((n) => n.name === "InlineMath");
    expect(im).toBeDefined();
    expect(im!.from).toBe(0);
    expect(im!.to).toBe(7);
  });

  it("does not span newlines", () => {
    const nodes = parseNodes("$broken\nmath$");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });
});

describe("InlineMath parser with \\(...\\) delimiters", () => {
  it("parses \\(E=mc^2\\) as InlineMath with 2-char marks", () => {
    const nodes = parseNodes("\\(E=mc^2\\)");
    const im = nodes.find((n) => n.name === "InlineMath");
    expect(im).toBeDefined();
    expect(im!.from).toBe(0);
    expect(im!.to).toBe(10);
    const marks = nodes.filter((n) => n.name === "InlineMathMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "InlineMathMark", from: 0, to: 2 });
    expect(marks[1]).toEqual({ name: "InlineMathMark", from: 8, to: 10 });
  });

  it("escaped opener \\\\(not math\\) does not parse", () => {
    const nodes = parseNodes("\\\\(not math\\)");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });

  it("bare parens inside content do not close: \\( f(x) \\)", () => {
    const nodes = parseNodes("\\( f(x) \\)");
    const im = nodes.find((n) => n.name === "InlineMath");
    expect(im).toBeDefined();
    expect(im!.from).toBe(0);
    expect(im!.to).toBe(10);
  });

  it("does not match \\(unclosed", () => {
    const nodes = parseNodes("\\(unclosed");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });

  it("does not span newlines", () => {
    const nodes = parseNodes("\\(broken\nmath\\)");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });

  it("mixed delimiters do not match: \\( x $", () => {
    const nodes = parseNodes("\\( x $");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });

  it("mixed delimiters do not match: $ x \\)", () => {
    const nodes = parseNodes("$ x \\)");
    expect(nodes.some((n) => n.name === "InlineMath")).toBe(false);
  });

  it("escaped dollar coexists with paren math: \\$5 and \\(x\\)", () => {
    const nodes = parseNodes("\\$5 and \\(x\\)");
    const im = nodes.find((n) => n.name === "InlineMath");
    expect(im).toBeDefined();
    expect(im!.from).toBe(8);
    expect(im!.to).toBe(13);
  });

  // Tradeoff: \( is math, not CommonMark escape — this is intentional.
  // Parentheses need no escaping in markdown, so \( as escape is unused
  // in practice. Users who want literal backslash+paren use \\(.
  it("f\\(x\\) is parsed as InlineMath (tradeoff: \\( is math, not CommonMark escape)", () => {
    const nodes = parseNodes("f\\(x\\)");
    const im = nodes.find((n) => n.name === "InlineMath");
    expect(im).toBeDefined();
    expect(im!.from).toBe(1);
    expect(im!.to).toBe(6);
    const marks = nodes.filter((n) => n.name === "InlineMathMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "InlineMathMark", from: 1, to: 3 });
    expect(marks[1]).toEqual({ name: "InlineMathMark", from: 4, to: 6 });
  });

  it("mid-sentence \\(x+1\\) is parsed as InlineMath", () => {
    const nodes = parseNodes("compute \\(x+1\\) here");
    const im = nodes.find((n) => n.name === "InlineMath");
    expect(im).toBeDefined();
    expect(im!.from).toBe(8);
    expect(im!.to).toBe(15);
    const marks = nodes.filter((n) => n.name === "InlineMathMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "InlineMathMark", from: 8, to: 10 });
    expect(marks[1]).toEqual({ name: "InlineMathMark", from: 13, to: 15 });
  });
});

describe("DisplayMath parser", () => {
  it("parses multi-line $$...$$  as DisplayMath", () => {
    const nodes = parseNodes("$$\ncontent\n$$");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
  });

  it("parses single-line $$E=mc^2$$ as DisplayMath", () => {
    const nodes = parseNodes("$$E=mc^2$$");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(10);
  });

  it("unclosed $$ still produces DisplayMath", () => {
    const nodes = parseNodes("$$\nunclosed");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
  });

  it("$$ must be at line start", () => {
    const nodes = parseNodes("text $$not display$$");
    expect(nodes.some((n) => n.name === "DisplayMath")).toBe(false);
  });

  it("parses $$content$$ {#eq:label} as DisplayMath covering only $$content$$", () => {
    const nodes = parseNodes("$$E=mc^2$$ {#eq:einstein}");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(10); // only $$E=mc^2$$, not the label
  });

  it("parses $$content$${#eq:label} (no space) as DisplayMath covering only $$content$$", () => {
    const nodes = parseNodes("$$E=mc^2$${#eq:einstein}");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(10);
  });

  it("does not match single-line $$ with arbitrary trailing text", () => {
    const nodes = parseNodes("$$E=mc^2$$ hello world");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    // Should NOT parse as single-line display math (arbitrary trailing text)
    // It will fall through to multi-line and create a broken block, but importantly
    // it should not create a clean single-line DisplayMath ending at position 10
    if (dm) {
      expect(dm.to).not.toBe(10);
    }
  });

  it("parses multi-line $$...$$ {#eq:label} on closing line", () => {
    const doc = "$$\ncontent\n$$ {#eq:einstein}";
    const nodes = parseNodes(doc);
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(13); // up to and including $$ on closing line
  });

  it("parses multi-line $$...$$  {#eq:label} with extra space", () => {
    const doc = "$$\ncontent\n$$  {#eq:test}";
    const nodes = parseNodes(doc);
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(13);
  });
});

describe("DisplayMath parser with \\[...\\] delimiters", () => {
  it("parses single-line \\[E=mc^2\\] as DisplayMath", () => {
    const nodes = parseNodes("\\[E=mc^2\\]");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(10);
  });

  it("parses \\[E=mc^2\\] {#eq:label} excluding the label", () => {
    const nodes = parseNodes("\\[E=mc^2\\] {#eq:einstein}");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(10);
  });

  it("parses multi-line \\[...\\] with close on its own line", () => {
    const doc = "\\[\nE=mc^2\n\\]";
    const nodes = parseNodes(doc);
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(doc.length);
  });

  it("parses multi-line \\[...\\] {#eq:label} on closing line, label excluded", () => {
    const doc = "\\[\nE=mc^2\n\\] {#eq:einstein}";
    const nodes = parseNodes(doc);
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(12); // ends after \] on closing line
  });

  it("closes when a content line ends with \\]", () => {
    const doc = "\\[\nE=mc^2 \\]";
    const nodes = parseNodes(doc);
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(12); // ends after \] at end of content line
  });

  it("content-line close with trailing label excludes the label", () => {
    const doc = "\\[\nE=mc^2 \\] {#eq:e}";
    const nodes = parseNodes(doc);
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(12);
  });

  it("unclosed \\[ produces DisplayMath to last line", () => {
    const doc = "\\[\nfoo";
    const nodes = parseNodes(doc);
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(doc.length);
  });

  it("escaped opener \\\\[ at line start does not parse", () => {
    const nodes = parseNodes("\\\\[not math\\]");
    expect(nodes.some((n) => n.name === "DisplayMath")).toBe(false);
  });

  it("\\[ inside fenced code does not parse", () => {
    const nodes = parseNodes("```\n\\[\nx\n\\]\n```");
    expect(nodes.some((n) => n.name === "DisplayMath")).toBe(false);
  });

  it("prose with \\[a\\] brackets is not parsed as DisplayMath", () => {
    const nodes = parseNodes("\\[a\\] and \\[b\\] are the options");
    expect(nodes.some((n) => n.name === "DisplayMath")).toBe(false);
  });

  it("\\[ with trailing content and no close is not multi-line DisplayMath", () => {
    const nodes = parseNodes("\\[content\nmore text");
    expect(nodes.some((n) => n.name === "DisplayMath")).toBe(false);
  });

  it("empty \\[\\] does not produce DisplayMath", () => {
    const nodes = parseNodes("\\[\\]");
    expect(nodes.some((n) => n.name === "DisplayMath")).toBe(false);
  });

  it("empty \\[\\] followed by content does not wrap to end of document", () => {
    const nodes = parseNodes("\\[\\]\nsome text\nmore text");
    expect(nodes.some((n) => n.name === "DisplayMath")).toBe(false);
  });

  it("\\[x\\] single-char content parses as DisplayMath", () => {
    const nodes = parseNodes("\\[x\\]");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(5);
  });
});

describe("DisplayMath empty-content consistency", () => {
  it("$$$$ (empty dollar display math) falls through to unclosed block", () => {
    // $$closeIdx = "$$$$".indexOf("$$", 2) = 2, closeIdx > 2 is false,
    // so same-line branch is skipped. Since close is "$$" (not "\\]"),
    // line 83 guard doesn't apply, and multi-line loop finds no closing $$.
    // Falls through to unclosed-block at line 102.
    const nodes = parseNodes("$$$$");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    // It creates an unclosed DisplayMath covering the whole line
    expect(dm!.from).toBe(0);
    expect(dm!.to).toBe(4);
  });

  it("$$$$ followed by content wraps to end (unclosed block)", () => {
    const nodes = parseNodes("$$$$\nsome text");
    const dm = nodes.find((n) => n.name === "DisplayMath");
    expect(dm).toBeDefined();
    // $$ on the second line matches the closeRe, so closes after "some text"
    // Actually: "$$$$" opens, nextLine gives "some text", closeRe doesn't match,
    // loop ends, falls to unclosed block covering to lastEnd
    expect(dm!.from).toBe(0);
  });
});
