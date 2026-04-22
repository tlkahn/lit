import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree, ensureSyntaxTree } from "@codemirror/language";
import { Frontmatter, FrontmatterYamlWrap } from "./frontmatter";

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

function resolveYamlNodes(doc: string, pos: number) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Frontmatter, FrontmatterYamlWrap] })],
  });
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const ancestors: { name: string; from: number; to: number }[] = [];
  let node = tree.resolveInner(pos, 1);
  while (node.parent) {
    ancestors.push({ name: node.name, from: node.from, to: node.to });
    node = node.parent;
  }
  return ancestors;
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

describe("Frontmatter with nested YAML parsing", () => {
  it("produces YAML Key nodes inside Frontmatter block", () => {
    const doc = "---\ntitle: Hello\ntags:\n  - a\n---\n\nBody";
    // pos 5 is inside "title"
    const nodes = resolveYamlNodes(doc, 5);
    expect(nodes.some((n) => n.name === "Key")).toBe(true);
  });

  it("--- delimiter lines are outside the YAML overlay", () => {
    const doc = "---\ntitle: Hello\n---\n\nBody";
    // pos 5 is inside "title" — should resolve to YAML Key
    const yamlNodes = resolveYamlNodes(doc, 5);
    expect(yamlNodes.some((n) => n.name === "Key")).toBe(true);
    // pos 0 is inside the opening "---" — should resolve to Frontmatter, not YAML
    const delimNodes = resolveYamlNodes(doc, 0);
    expect(delimNodes.some((n) => n.name === "Key")).toBe(false);
  });
});
