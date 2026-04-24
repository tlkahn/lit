import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxTree } from "@codemirror/language";

describe("Find inline code node name", () => {
  it("shows all node names in backtick code", () => {
    const state = EditorState.create({
      doc: "This is `inline code` and more",
      extensions: [markdown({ extensions: [GFM] })],
    });
    const tree = syntaxTree(state);
    const nodes: string[] = [];
    tree.iterate({
      enter: (node) => {
        nodes.push(node.name);
      }
    });
    console.log("All node names:", nodes);
    expect(nodes.length).toBeGreaterThan(0);
  });
});
