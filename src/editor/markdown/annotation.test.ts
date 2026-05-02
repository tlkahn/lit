import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { Annotation } from "./annotation";
import { Comment } from "./comment";

function parseNodes(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Comment, Annotation] })],
  });
  const nodes: { name: string; from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

describe("InlineAnnotation parser", () => {
  it("parses %%!note%% as InlineAnnotation mid-line", () => {
    const nodes = parseNodes("text %%!note%% more");
    const ia = nodes.find((n) => n.name === "InlineAnnotation");
    expect(ia).toBeDefined();
    expect(ia!.from).toBe(5);
    expect(ia!.to).toBe(14);
  });

  it("produces InlineAnnotationMark children at correct positions", () => {
    const nodes = parseNodes("text %%!note%% more");
    const marks = nodes.filter((n) => n.name === "InlineAnnotationMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "InlineAnnotationMark", from: 5, to: 8 });
    expect(marks[1]).toEqual({ name: "InlineAnnotationMark", from: 12, to: 14 });
  });

  it("does not match plain %%hidden%% — still InlineComment", () => {
    const nodes = parseNodes("text %%hidden%% more");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
    expect(nodes.some((n) => n.name === "InlineComment")).toBe(true);
  });

  it("does not match unclosed %%!", () => {
    const nodes = parseNodes("text %%!unclosed");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
  });

  it("does not match single %", () => {
    const nodes = parseNodes("%!not annotation%");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
  });

  it("does not span newlines", () => {
    const nodes = parseNodes("%%!broken\nannotation%%");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
  });

  it("parses adjacent annotations as two separate nodes", () => {
    const nodes = parseNodes("text %%!a%%%%!b%% end");
    const annotations = nodes.filter((n) => n.name === "InlineAnnotation");
    expect(annotations).toHaveLength(2);
    expect(annotations[0]!.from).toBe(5);
    expect(annotations[0]!.to).toBe(11);
    expect(annotations[1]!.from).toBe(11);
    expect(annotations[1]!.to).toBe(17);
  });
});

describe("BlockAnnotation parser", () => {
  it("parses multi-line %%!...%% as BlockAnnotation", () => {
    const nodes = parseNodes("%%!\ncontent\n%%");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
    expect(ba!.from).toBe(0);
    expect(ba!.to).toBe(14);
  });

  it("does not match plain %%...%% — still BlockComment", () => {
    const nodes = parseNodes("%%\ncontent\n%%");
    expect(nodes.some((n) => n.name === "BlockAnnotation")).toBe(false);
    expect(nodes.some((n) => n.name === "BlockComment")).toBe(true);
  });

  it("parses single-line %%!content%% at line start as BlockAnnotation", () => {
    const nodes = parseNodes("%%!content%%");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
    expect(ba!.from).toBe(0);
    expect(ba!.to).toBe(12);
  });

  it("unclosed %%! still produces BlockAnnotation (graceful degradation)", () => {
    const nodes = parseNodes("%%!\nunclosed");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
  });

  it("closing %% with trailing whitespace works", () => {
    const nodes = parseNodes("%%!\ncontent\n%%  ");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
  });
});
