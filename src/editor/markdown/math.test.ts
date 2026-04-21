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
});
