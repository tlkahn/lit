import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { Comment } from "./comment";

function parseNodes(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ extensions: [Comment] })],
  });
  const nodes: { name: string; from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      nodes.push({ name: node.name, from: node.from, to: node.to });
    },
  });
  return nodes;
}

describe("InlineComment parser", () => {
  it("parses %%hidden%% as InlineComment mid-line", () => {
    const nodes = parseNodes("text %%hidden%% more");
    const ic = nodes.find((n) => n.name === "InlineComment");
    expect(ic).toBeDefined();
    expect(ic!.from).toBe(5);
    expect(ic!.to).toBe(15);
  });

  it("produces InlineCommentMark children at correct positions", () => {
    const nodes = parseNodes("text %%hidden%% more");
    const marks = nodes.filter((n) => n.name === "InlineCommentMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "InlineCommentMark", from: 5, to: 7 });
    expect(marks[1]).toEqual({ name: "InlineCommentMark", from: 13, to: 15 });
  });

  it("single % does not match", () => {
    const nodes = parseNodes("%not a comment%");
    expect(nodes.some((n) => n.name === "InlineComment")).toBe(false);
  });

  it("spaces inside work", () => {
    const nodes = parseNodes("text %% spaced %% more");
    const ic = nodes.find((n) => n.name === "InlineComment");
    expect(ic).toBeDefined();
    expect(ic!.from).toBe(5);
    expect(ic!.to).toBe(17);
  });

  it("does not span newlines", () => {
    const nodes = parseNodes("%%broken\ncomment%%");
    expect(nodes.some((n) => n.name === "InlineComment")).toBe(false);
  });

  it("works mid-line", () => {
    const nodes = parseNodes("text %%hidden%% more");
    const ic = nodes.find((n) => n.name === "InlineComment");
    expect(ic).toBeDefined();
    expect(ic!.from).toBe(5);
    expect(ic!.to).toBe(15);
  });

  it("unclosed %% does not match inline", () => {
    const nodes = parseNodes("text %%unclosed");
    expect(nodes.some((n) => n.name === "InlineComment")).toBe(false);
  });
});

describe("BlockComment parser", () => {
  it("parses multi-line %%...%% as BlockComment", () => {
    const nodes = parseNodes("%%\ncontent\n%%");
    const bc = nodes.find((n) => n.name === "BlockComment");
    expect(bc).toBeDefined();
    expect(bc!.from).toBe(0);
  });

  it("parses single-line %%content%% at line start as BlockComment", () => {
    const nodes = parseNodes("%%content%%");
    const bc = nodes.find((n) => n.name === "BlockComment");
    expect(bc).toBeDefined();
    expect(bc!.from).toBe(0);
    expect(bc!.to).toBe(11);
  });

  it("unclosed %% still produces BlockComment", () => {
    const nodes = parseNodes("%%\nunclosed");
    const bc = nodes.find((n) => n.name === "BlockComment");
    expect(bc).toBeDefined();
  });

  it("%% must be at line start for block", () => {
    const nodes = parseNodes("text %%not block%%");
    expect(nodes.some((n) => n.name === "BlockComment")).toBe(false);
  });

  it("closing %% with trailing whitespace works", () => {
    const nodes = parseNodes("%%\ncontent\n%%  ");
    const bc = nodes.find((n) => n.name === "BlockComment");
    expect(bc).toBeDefined();
  });
});
