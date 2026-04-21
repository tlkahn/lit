import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { WikiLink } from "./wikilink";

function parseNodes(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [WikiLink] })],
  });
  const nodes: { name: string; from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

describe("WikiLink parser", () => {
  it("parses [[Page Name]] as WikiLink node", () => {
    const nodes = parseNodes("[[Page Name]]");
    const wl = nodes.find((n) => n.name === "WikiLink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(0);
    expect(wl!.to).toBe(13);
  });

  it("produces WikiLinkMark children for [[ and ]]", () => {
    const nodes = parseNodes("[[Page Name]]");
    const marks = nodes.filter((n) => n.name === "WikiLinkMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "WikiLinkMark", from: 0, to: 2 });
    expect(marks[1]).toEqual({ name: "WikiLinkMark", from: 11, to: 13 });
  });

  it("parses [[Page|Display]] with pipe alias", () => {
    const nodes = parseNodes("[[Page|Display]]");
    const wl = nodes.find((n) => n.name === "WikiLink");
    expect(wl).toBeDefined();
    expect(wl!.from).toBe(0);
    expect(wl!.to).toBe(16);
  });

  it("does not match single [", () => {
    const nodes = parseNodes("[not a wikilink]");
    expect(nodes.some((n) => n.name === "WikiLink")).toBe(false);
  });

  it("does not match unclosed [[", () => {
    const nodes = parseNodes("[[unclosed");
    expect(nodes.some((n) => n.name === "WikiLink")).toBe(false);
  });

  it("does not span newlines", () => {
    const nodes = parseNodes("[[broken\nlink]]");
    expect(nodes.some((n) => n.name === "WikiLink")).toBe(false);
  });

  it("works at start of line", () => {
    const nodes = parseNodes("[[Start]]");
    expect(nodes.some((n) => n.name === "WikiLink")).toBe(true);
  });

  it("works in middle of line", () => {
    const nodes = parseNodes("see [[Middle]] here");
    const wl = nodes.find((n) => n.name === "WikiLink")!;
    expect(wl.from).toBe(4);
    expect(wl.to).toBe(14);
  });

  it("works at end of line", () => {
    const nodes = parseNodes("see [[End]]");
    const wl = nodes.find((n) => n.name === "WikiLink")!;
    expect(wl.from).toBe(4);
    expect(wl.to).toBe(11);
  });
});
