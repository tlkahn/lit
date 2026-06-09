import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { ensureSyntaxTree } from "@codemirror/language";
import { bibtex } from "./bibtex";

interface NodeSlice {
  name: string;
  text: string;
}

/**
 * Build a state with the bibtex StreamLanguage, force-parse it, and collect
 * (nodeName, slicedText) pairs. StreamLanguage tokenTable tokens surface as
 * tree nodes named after the token key (e.g. "entryType", "string").
 */
function parseNodes(doc: string): NodeSlice[] {
  const state = EditorState.create({ doc, extensions: [bibtex()] });
  const tree = ensureSyntaxTree(state, doc.length, 5000)!;
  const nodes: NodeSlice[] = [];
  tree.iterate({
    enter: (node) => {
      nodes.push({ name: node.name, text: doc.slice(node.from, node.to) });
    },
  });
  return nodes;
}

function hasNode(nodes: NodeSlice[], name: string, text: string): boolean {
  return nodes.some((n) => n.name === name && n.text === text);
}

describe("bibtex StreamLanguage", () => {
  it("highlights an @article entry type", () => {
    const nodes = parseNodes("@article{key,");
    expect(hasNode(nodes, "entryType", "@article")).toBe(true);
  });

  it("highlights field name, '=' operator, and braced string", () => {
    const nodes = parseNodes("@book{k,\ntitle = {Hello World},\n}");
    expect(hasNode(nodes, "fieldName", "title")).toBe(true);
    expect(hasNode(nodes, "defOp", "=")).toBe(true);
    expect(hasNode(nodes, "string", "{Hello World}")).toBe(true);
  });

  it("highlights a quoted string value", () => {
    const nodes = parseNodes('@book{k,\nauthor = "Doe, J",\n}');
    expect(hasNode(nodes, "string", '"Doe, J"')).toBe(true);
  });

  it("treats nested balanced braces as one string node", () => {
    const nodes = parseNodes("@book{k,\ntitle = {a {b} c},\n}");
    expect(hasNode(nodes, "string", "{a {b} c}")).toBe(true);
  });

  it("highlights a % comment line", () => {
    const nodes = parseNodes("% comment line");
    expect(hasNode(nodes, "lineComment", "% comment line")).toBe(true);
  });

  it("highlights the '#' concatenation operator", () => {
    const nodes = parseNodes('@book{k,\ntitle = "a" # "b",\n}');
    expect(hasNode(nodes, "op", "#")).toBe(true);
  });

  it("does not hang or throw on an unterminated brace to EOF", () => {
    expect(() => parseNodes("@book{k,\ntitle = {unterminated")).not.toThrow();
  });

  it("does not hang or throw on an unterminated quote to EOF", () => {
    expect(() => parseNodes('@book{k,\nauthor = "unterminated')).not.toThrow();
  });

  it("does not swallow the cite key into the entry-opening brace", () => {
    const nodes = parseNodes("@article{key,");
    // The entry-opening `{` must NOT be tokenized together with the key.
    expect(hasNode(nodes, "string", "{key,")).toBe(false);
    // The cite key is now visible to the highlighter as a field name.
    expect(hasNode(nodes, "fieldName", "key")).toBe(true);
    // The entry-opening brace surfaces as punctuation.
    expect(hasNode(nodes, "punctuation", "{")).toBe(true);
  });

  it("keeps a multi-line braced value typed as string across lines", () => {
    const nodes = parseNodes("@book{k,\ntitle = {Hello\nWorld},\n}");
    expect(hasNode(nodes, "fieldName", "title")).toBe(true);
    expect(hasNode(nodes, "defOp", "=")).toBe(true);
    // Each line's slice of the braced value is typed "string".
    expect(hasNode(nodes, "string", "{Hello")).toBe(true);
    expect(hasNode(nodes, "string", "World}")).toBe(true);
    // The continuation line must NOT be re-tokenized as a field name.
    expect(hasNode(nodes, "fieldName", "World")).toBe(false);
  });
});
