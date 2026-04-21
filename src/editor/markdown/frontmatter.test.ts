import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { Frontmatter } from "./frontmatter";

function parseNodes(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Frontmatter] })],
  });
  const nodes: { name: string; from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

describe("Frontmatter parser", () => {
  it("parses ---\\nkey: value\\n--- at doc start as Frontmatter", () => {
    const nodes = parseNodes("---\nkey: value\n---");
    const fm = nodes.find((n) => n.name === "Frontmatter");
    expect(fm).toBeDefined();
    expect(fm!.from).toBe(0);
  });

  it("does not produce HorizontalRule for opening ---", () => {
    const nodes = parseNodes("---\nkey: value\n---");
    const hrs = nodes.filter((n) => n.name === "HorizontalRule");
    expect(hrs).toHaveLength(0);
  });

  it("recognizes empty frontmatter ---\\n---", () => {
    const nodes = parseNodes("---\n---");
    const fm = nodes.find((n) => n.name === "Frontmatter");
    expect(fm).toBeDefined();
  });

  it("--- in the middle of document is still HorizontalRule", () => {
    const nodes = parseNodes("Hello\n\n---\n\nWorld");
    expect(nodes.some((n) => n.name === "HorizontalRule")).toBe(true);
    expect(nodes.some((n) => n.name === "Frontmatter")).toBe(false);
  });

  it("unclosed --- at doc start still produces Frontmatter", () => {
    const nodes = parseNodes("---\nkey: value");
    const fm = nodes.find((n) => n.name === "Frontmatter");
    expect(fm).toBeDefined();
  });
});
