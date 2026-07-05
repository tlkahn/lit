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
});
