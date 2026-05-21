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

  it("two standalone single-line annotations separated by paragraphs", () => {
    const doc = [
      "3.生气时先默数10秒再说话(卡耐基基金会)",
      "",
      "%%! q \\s | what does this mean? %%",
      "",
      "4.接电话前先微笑(加州大学)",
      "",
      "%%! q \\s | what does this mean? %%",
    ].join("\n");
    const nodes = parseNodes(doc);
    const annotations = nodes.filter((n) => n.name === "BlockAnnotation");
    expect(annotations).toHaveLength(2);

    // Verify positions match expected offsets
    const line1 = "3.生气时先默数10秒再说话(卡耐基基金会)";
    const annText = "%%! q \\s | what does this mean? %%";
    const line2 = "4.接电话前先微笑(加州大学)";
    // first annotation starts after line1 + \n + \n
    const ann1Start = line1.length + 1 + 1;
    const ann1End = ann1Start + annText.length;
    expect(annotations[0]!.from).toBe(ann1Start);
    expect(annotations[0]!.to).toBe(ann1End);
    // second annotation starts after ann1End + \n + \n + line2 + \n + \n
    const ann2Start = ann1End + 1 + 1 + line2.length + 1 + 1;
    const ann2End = ann2Start + annText.length;
    expect(annotations[1]!.from).toBe(ann2Start);
    expect(annotations[1]!.to).toBe(ann2End);
  });

  it("multi-line block annotation directly after paragraph (no blank line)", () => {
    const doc = [
      "4.接电话前先微笑(加州大学)",
      "%%!",
      "n",
      "---",
      "body text",
      "%%",
    ].join("\n");
    const nodes = parseNodes(doc);
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
  });

  it("single-line annotation directly after paragraph (no blank line)", () => {
    const doc = "some paragraph text\n%%! q \\s | note %%";
    const nodes = parseNodes(doc);
    const ba = nodes.find((n) => n.name === "BlockAnnotation" || n.name === "InlineAnnotation");
    expect(ba).toBeDefined();
  });

  it("single-line annotation with trailing whitespace", () => {
    const doc = "%%! q \\s | what does this mean? %% ";
    const nodes = parseNodes(doc);
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
    expect(ba!.from).toBe(0);
    // node should exclude trailing whitespace
    expect(ba!.to).toBe(doc.trimEnd().length);
  });

  it("trailing-space annotation after paragraph does not swallow subsequent block annotation", () => {
    const doc = [
      "3.生气时先默数10秒再说话(卡耐基基金会)",
      "%%! q \\s | what does this mean? %% ",
      "",
      "%%!",
      "n",
      "---",
      "body text",
      "%%",
    ].join("\n");
    const nodes = parseNodes(doc);
    const annotations = nodes.filter((n) => n.name === "BlockAnnotation");
    expect(annotations).toHaveLength(2);
  });

  it("real-world: two annotation groups with trailing spaces (user bug report)", () => {
    const doc = [
      "3.生气时先默数10秒再说话(卡耐基基金会) -- renders",
      "%%! q \\s | what does this mean? %% ",
      "",
      "%%!",
      "n",
      "---",
      "## Translation & Explanation",
      "",
      "**Chinese text:** 生气时先默数10秒再说话",
      "",
      "**Translation:**",
      '> "When angry, silently count to 10 seconds before speaking"',
      "%%",
      "",
      "4.接电话前先微笑(加州大学) -- not renders",
      "",
      "%%! q \\s | what does this mean? %% ",
      "",
      "%%!",
      "n",
      "---",
      "## Translation and Explanation",
      "",
      '**"接电话前先微笑"** (jiē diànhuà qián xiān wēixiào)',
      "",
      "This is a **Chinese phrase** that translates to:",
      "",
      "...",
      "%%",
    ].join("\n");
    const nodes = parseNodes(doc);
    const annotations = nodes.filter((n) => n.name === "BlockAnnotation");
    // Should find 4 annotations: 2 single-line + 2 multi-line
    expect(annotations).toHaveLength(4);
  });
});
