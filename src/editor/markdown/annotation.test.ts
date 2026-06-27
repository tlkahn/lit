import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree } from "@codemirror/language";
import { GFM } from "@lezer/markdown";
import { Annotation } from "./annotation";
import { Comment } from "./comment";
import { WikiLink } from "./wikilink";
import { Frontmatter, FrontmatterYamlWrap } from "./frontmatter";
import { Math } from "./math";
import { Footnote } from "./footnote";

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
  it("parses <!---note---> as InlineAnnotation mid-line", () => {
    // "text " = 5 chars, "<!---note--->" = 13 chars (5+4+4), ends at 18
    const nodes = parseNodes("text <!---note---> more");
    const ia = nodes.find((n) => n.name === "InlineAnnotation");
    expect(ia).toBeDefined();
    expect(ia!.from).toBe(5);
    expect(ia!.to).toBe(18);
  });

  it("produces InlineAnnotationMark children at correct positions", () => {
    // "text " = 5, open mark: 5..10 (5 chars), close mark: 14..18 (4 chars)
    const nodes = parseNodes("text <!---note---> more");
    const marks = nodes.filter((n) => n.name === "InlineAnnotationMark");
    expect(marks).toHaveLength(2);
    expect(marks[0]).toEqual({ name: "InlineAnnotationMark", from: 5, to: 10 });
    expect(marks[1]).toEqual({ name: "InlineAnnotationMark", from: 14, to: 18 });
  });

  it("does not match plain %%hidden%% — still InlineComment", () => {
    const nodes = parseNodes("text %%hidden%% more");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
    expect(nodes.some((n) => n.name === "InlineComment")).toBe(true);
  });

  it("does not match unclosed <!---", () => {
    const nodes = parseNodes("text <!---unclosed");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
  });

  it("does not match single <", () => {
    const nodes = parseNodes("<!not annotation--->");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
  });

  it("does not span newlines", () => {
    const nodes = parseNodes("<!---broken\nannotation--->");
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
  });

  it("parses adjacent annotations as two separate nodes", () => {
    // "text " = 5
    // "<!---a--->" = 10 chars (5+1+4), from 5 to 15
    // "<!---b--->" = 10 chars, from 15 to 25
    const nodes = parseNodes("text <!---a---><!---b---> end");
    const annotations = nodes.filter((n) => n.name === "InlineAnnotation");
    expect(annotations).toHaveLength(2);
    expect(annotations[0]!.from).toBe(5);
    expect(annotations[0]!.to).toBe(15);
    expect(annotations[1]!.from).toBe(15);
    expect(annotations[1]!.to).toBe(25);
  });
});

describe("BlockAnnotation parser", () => {
  it("parses multi-line <!---...--->  as BlockAnnotation", () => {
    // "<!---\ncontent\n--->" = 5+1+7+1+4 = 18
    const nodes = parseNodes("<!---\ncontent\n--->");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
    expect(ba!.from).toBe(0);
    expect(ba!.to).toBe(18);
  });

  it("does not match plain %%...%% — still BlockComment", () => {
    const nodes = parseNodes("%%\ncontent\n%%");
    expect(nodes.some((n) => n.name === "BlockAnnotation")).toBe(false);
    expect(nodes.some((n) => n.name === "BlockComment")).toBe(true);
  });

  it("parses single-line <!---content---> at line start as BlockAnnotation", () => {
    // "<!---content--->" = 5+7+4 = 16
    const nodes = parseNodes("<!---content--->");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
    expect(ba!.from).toBe(0);
    expect(ba!.to).toBe(16);
  });

  it("unclosed <!--- still produces BlockAnnotation (graceful degradation)", () => {
    const nodes = parseNodes("<!---\nunclosed");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
  });

  it("closing ---> with trailing whitespace works", () => {
    const nodes = parseNodes("<!---\ncontent\n--->  ");
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
  });

  it("two standalone single-line annotations separated by paragraphs", () => {
    const doc = [
      "3.生气时先默数10秒再说话(卡耐基基金会)",
      "",
      "<!--- q \\s | what does this mean? --->",
      "",
      "4.接电话前先微笑(加州大学)",
      "",
      "<!--- q \\s | what does this mean? --->",
    ].join("\n");
    const nodes = parseNodes(doc);
    const annotations = nodes.filter((n) => n.name === "BlockAnnotation");
    expect(annotations).toHaveLength(2);

    // Verify positions match expected offsets
    const line1 = "3.生气时先默数10秒再说话(卡耐基基金会)";
    const annText = "<!--- q \\s | what does this mean? --->";
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

  it("multi-line block annotation directly after paragraph (no blank line) renders", () => {
    const doc = [
      "4.接电话前先微笑(加州大学)",
      "<!---",
      "n",
      "---",
      "body text",
      "--->",
    ].join("\n");
    const nodes = parseNodes(doc);
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
  });

  it("single-line annotation directly after paragraph (no blank line) becomes block", () => {
    // With <!--- delimiter, the built-in HTML comment block parser's endLeaf
    // ends the paragraph, so single-line annotations on their own line after
    // a paragraph are now parsed as BlockAnnotation (not InlineAnnotation).
    const doc = "some paragraph text\n<!--- q \\s | note --->";
    const nodes = parseNodes(doc);
    const block = nodes.find((n) => n.name === "BlockAnnotation");
    expect(block).toBeDefined();
  });

  it("minimal single-line annotation after paragraph becomes block", () => {
    const doc = "paragraph\n<!--- x --->";
    const nodes = parseNodes(doc);
    const block = nodes.find((n) => n.name === "BlockAnnotation");
    expect(block).toBeDefined();
  });

  it("single-line annotation with trailing whitespace after paragraph becomes block", () => {
    const doc = "paragraph\n<!--- content --->   ";
    const nodes = parseNodes(doc);
    const block = nodes.find((n) => n.name === "BlockAnnotation");
    expect(block).toBeDefined();
  });

  it("<!--- with closing ---> and trailing text after paragraph becomes block ending at --->", () => {
    // The built-in HTML endLeaf ends the paragraph. Our block parser sees
    // the line starts with <!--- and finds ---> on the same line, so it
    // creates a BlockAnnotation ending at the close of --->.
    const doc = "paragraph\n<!--- note ---> some trailing text";
    const nodes = parseNodes(doc);
    const block = nodes.find((n) => n.name === "BlockAnnotation");
    expect(block).toBeDefined();
    // "paragraph\n" = 10 chars, annotation starts at 10
    // "<!--- note --->" = 15 chars, ends at 25
    expect(block!.from).toBe(10);
    expect(block!.to).toBe(25);
  });

  it("single-line annotation with trailing content does not swallow subsequent lines", () => {
    const doc = "<!--- note ---> see ref\nnext paragraph";
    const nodes = parseNodes(doc);
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
    // "<!--- note --->" = 15 chars, annotation ends at close of --->
    expect(ba!.from).toBe(0);
    expect(ba!.to).toBe(15);
    // Ensure there is no second BlockAnnotation (trailing content not swallowed)
    const allBlocks = nodes.filter((n) => n.name === "BlockAnnotation");
    expect(allBlocks).toHaveLength(1);
    // "next paragraph" should be parsed as a Paragraph, not consumed
    const para = nodes.filter((n) => n.name === "Paragraph");
    expect(para.length).toBeGreaterThanOrEqual(1);
  });

  it("single-line annotation with trailing whitespace", () => {
    const doc = "<!--- q \\s | what does this mean? ---> ";
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
      "<!--- q \\s | what does this mean? ---> ",
      "",
      "<!---",
      "n",
      "---",
      "body text",
      "--->",
    ].join("\n");
    const nodes = parseNodes(doc);
    // With <!--- delimiter, both annotations become blocks
    // (the built-in HTML comment endLeaf ends the paragraph)
    const block = nodes.filter((n) => n.name === "BlockAnnotation");
    expect(block).toHaveLength(2);
  });

  it("real-world: two annotation groups with trailing spaces (user bug report)", () => {
    const doc = [
      "3.生气时先默数10秒再说话(卡耐基基金会) -- renders",
      "<!--- q \\s | what does this mean? ---> ",
      "",
      "<!---",
      "n",
      "---",
      "## Translation & Explanation",
      "",
      "**Chinese text:** 生气时先默数10秒再说话",
      "",
      "**Translation:**",
      '> "When angry, silently count to 10 seconds before speaking"',
      "--->",
      "",
      "4.接电话前先微笑(加州大学) -- not renders",
      "",
      "<!--- q \\s | what does this mean? ---> ",
      "",
      "<!---",
      "n",
      "---",
      "## Translation and Explanation",
      "",
      '**"接电话前先微笑"** (jiē diànhuà qián xiān wēixiào)',
      "",
      "This is a **Chinese phrase** that translates to:",
      "",
      "...",
      "--->",
    ].join("\n");
    const nodes = parseNodes(doc);
    const block = nodes.filter((n) => n.name === "BlockAnnotation");
    // With <!--- delimiter, all annotations become blocks
    // (the built-in HTML comment endLeaf ends paragraphs before inline parsing)
    expect(block).toHaveLength(4);
  });

  it("block annotation body with backticks parses correctly", () => {
    const allExtensions = [GFM, WikiLink, Frontmatter, FrontmatterYamlWrap, Math, Comment, Annotation, Footnote];
    const doc = [
      "<!---",
      "n",
      "---",
      "body with `code` here",
      "--->",
    ].join("\n");
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: allExtensions })],
    });
    const nodes: { name: string; from: number; to: number }[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        nodes.push({ name: node.name, from: node.from, to: node.to });
      },
    });
    const ba = nodes.find((n) => n.name === "BlockAnnotation");
    expect(ba).toBeDefined();
  });

  it("block annotation after paragraph renders with full extension set (GFM, Frontmatter, etc.)", () => {
    const allExtensions = [GFM, WikiLink, Frontmatter, FrontmatterYamlWrap, Math, Comment, Annotation, Footnote];
    const doc = [
      "---",
      "title: test",
      "---",
      "3.生气时先默数10秒再说话(卡耐基基金会)",
      "",
      "<!---",
      "n",
      "\\s",
      "---",
      "## Translation & Explanation",
      "",
      "**Chinese text:** 生气时先默数10秒再说话",
      "--->",
      "",
      "4.接电话前先微笑(加州大学)",
      "<!---",
      "n",
      "---",
      "## Translation and Explanation",
      "",
      "body text",
      "--->",
    ].join("\n");
    const state = EditorState.create({
      doc,
      extensions: [markdown({ extensions: allExtensions })],
    });
    const nodes: { name: string; from: number; to: number }[] = [];
    syntaxTree(state).iterate({
      enter: (node) => {
        nodes.push({ name: node.name, from: node.from, to: node.to });
      },
    });
    const blocks = nodes.filter((n) => n.name === "BlockAnnotation");
    expect(blocks).toHaveLength(2);
  });
});

describe("AnnotationBacktickGuard", () => {
  it("paired backticks before inline annotation do not interfere", () => {
    const doc = "some `code` text<!---[id]n!---body--->";
    const nodes = parseNodes(doc);
    const ia = nodes.find((n) => n.name === "InlineAnnotation");
    expect(ia).toBeDefined();
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(true);
  });

  it("unpaired backtick before annotation is neutralized by guard", () => {
    const doc = "concept of `scaling and abilities<!---[id]n!---body--->more";
    const nodes = parseNodes(doc);
    const ia = nodes.find((n) => n.name === "InlineAnnotation");
    expect(ia).toBeDefined();
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(false);
  });

  it("backtick pairing with backtick inside annotation body is prevented", () => {
    const doc = "concept of `scaling and abilities<!---[id]n!---body with code` here--->more";
    const nodes = parseNodes(doc);
    const ia = nodes.find((n) => n.name === "InlineAnnotation");
    expect(ia).toBeDefined();
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(false);
  });

  it("annotation fully enclosed in backticks is left for InlineCode", () => {
    const doc = "show syntax: `<!---[id]n!---body--->` rest";
    const nodes = parseNodes(doc);
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(true);
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(false);
  });

  it("exact issue reproducer: backtick pairs with backtick inside body", () => {
    const doc =
      "concept of `scaling and abilities<!---[uuid]n!---body with code` here--->more";
    const nodes = parseNodes(doc);
    const ia = nodes.find((n) => n.name === "InlineAnnotation");
    expect(ia).toBeDefined();
    expect(ia!.from).toBe(doc.indexOf("<!---"));
    expect(ia!.to).toBe(doc.indexOf("--->") + 4);
  });

  it("multiple annotations after an unpaired backtick", () => {
    const doc = "a `b<!---x--->c<!---y--->d";
    const nodes = parseNodes(doc);
    const annotations = nodes.filter((n) => n.name === "InlineAnnotation");
    expect(annotations).toHaveLength(2);
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(false);
  });

  it("double-backtick fence pairing across annotation is prevented", () => {
    const doc = "text ``code<!---[id]n!---body`` rest--->more";
    const nodes = parseNodes(doc);
    const ia = nodes.find((n) => n.name === "InlineAnnotation");
    expect(ia).toBeDefined();
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(false);
  });

  it("backtick after closed annotation does not trigger guard", () => {
    const doc = "text<!---[id]n!---body--->rest `code` end";
    const nodes = parseNodes(doc);
    expect(nodes.some((n) => n.name === "InlineAnnotation")).toBe(true);
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(true);
  });

  it("two backticks pair with each other, enclosing first annotation in InlineCode", () => {
    const doc = "a `b<!---x--->c `d<!---y--->e";
    const nodes = parseNodes(doc);
    const annotations = nodes.filter((n) => n.name === "InlineAnnotation");
    expect(annotations).toHaveLength(1);
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(true);
  });

  it("mismatched fence sizes leave both backticks unpaired, both annotations survive", () => {
    const doc = "a `b<!---x--->c ``d<!---y--->e";
    const nodes = parseNodes(doc);
    const annotations = nodes.filter((n) => n.name === "InlineAnnotation");
    expect(annotations).toHaveLength(2);
    expect(nodes.some((n) => n.name === "InlineCode")).toBe(false);
  });
});
