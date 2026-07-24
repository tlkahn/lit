import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { Footnote } from "../markdown/footnote";
import { syntaxTree } from "@codemirror/language";
import { Decoration } from "@codemirror/view";
import { normalizeRefLabel, collectRefDefLabels, addPlainBracketDecos, getRefDefLabels } from "./plainBrackets";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

const mdExtensions = [GFM, WikiLink, MathExt, CommentExt, Footnote];

function makeState(doc: string, cursor = 0): EditorState {
  return EditorState.create({
    doc,
    selection: { anchor: cursor },
    extensions: [markdown({ extensions: mdExtensions })],
  });
}

describe("normalizeRefLabel", () => {
  it("lowercases", () => {
    expect(normalizeRefLabel("Foo")).toBe("foo");
  });

  it("trims leading/trailing whitespace", () => {
    expect(normalizeRefLabel("  bar  ")).toBe("bar");
  });

  it("collapses internal whitespace runs to single space", () => {
    expect(normalizeRefLabel("Foo  Bar")).toBe("foo bar");
  });

  it("collapses tabs and newlines", () => {
    expect(normalizeRefLabel("Foo\t\nBar")).toBe("foo bar");
  });

  it("handles mixed case + whitespace", () => {
    expect(normalizeRefLabel("  Foo   BAR  baz  ")).toBe("foo bar baz");
  });
});

describe("collectRefDefLabels", () => {
  it("collects labels from link reference definitions", () => {
    const state = makeState("[bar]: https://example.com\n[Foo  Bar]: https://x.com\n\nsome text");
    const labels = collectRefDefLabels(state);
    expect(labels.has("bar")).toBe(true);
    expect(labels.has("foo bar")).toBe(true);
  });

  it("returns empty set when no definitions exist", () => {
    const state = makeState("just some plain text\nwith [links] but no definitions");
    const labels = collectRefDefLabels(state);
    expect(labels.size).toBe(0);
  });

  it("does not pick up inline [foo]: x mid-paragraph as a definition", () => {
    const state = makeState("This is not a def [foo]: something in the middle of a paragraph.");
    const labels = collectRefDefLabels(state);
    expect(labels.has("foo")).toBe(false);
  });

  it("normalizes definition labels: case + whitespace", () => {
    const state = makeState("[FOO  BAR]: https://example.com\n\ntext");
    const labels = collectRefDefLabels(state);
    expect(labels.has("foo bar")).toBe(true);
    expect(labels.has("FOO  BAR")).toBe(false);
  });
});

describe("addPlainBracketDecos - classification", () => {
  function classifyNodes(doc: string): { from: number; to: number; text: string; neutralized: boolean }[] {
    const state = makeState(doc);
    const tree = syntaxTree(state);
    const refLabels = collectRefDefLabels(state);
    const results: { from: number; to: number; text: string; neutralized: boolean }[] = [];

    tree.iterate({
      enter: (node) => {
        if (node.name === "Link" || node.name === "Image") {
          const decos: { from: number; to: number; deco: Decoration }[] = [];
          addPlainBracketDecos(state, node.from, node.to, node.node, refLabels, decos);
          results.push({
            from: node.from,
            to: node.to,
            text: state.doc.sliceString(node.from, node.to),
            neutralized: decos.length > 0,
          });
          return false;
        }
      },
    });
    return results;
  }

  it("neutralizes bare [sic]", () => {
    const nodes = classifyNodes("This [sic] is text");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(true);
  });

  it("neutralizes bare [3]", () => {
    const nodes = classifyNodes("See item [3] below");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(true);
  });

  it("neutralizes bare [TODO]", () => {
    const nodes = classifyNodes("Fix this [TODO] later");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(true);
  });

  it("does NOT neutralize inline link [foo](url)", () => {
    const nodes = classifyNodes("Click [foo](https://example.com) here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(false);
  });

  it("does NOT neutralize empty inline link [foo]()", () => {
    const nodes = classifyNodes("Click [foo]() here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(false);
  });

  it("does NOT neutralize inline image ![alt](img.png)", () => {
    const nodes = classifyNodes("See ![alt](img.png) here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(false);
  });

  it("neutralizes bare image ![foo] without def", () => {
    const nodes = classifyNodes("See ![foo] here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(true);
  });

  it("does NOT neutralize shortcut ref [bar] WITH def", () => {
    const nodes = classifyNodes("[bar]: https://example.com\n\nSee [bar] here");
    const barNode = nodes.find((n) => n.text === "[bar]");
    expect(barNode).toBeDefined();
    expect(barNode!.neutralized).toBe(false);
  });

  it("neutralizes shortcut ref [bar] WITHOUT def", () => {
    const nodes = classifyNodes("See [bar] here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(true);
  });

  it("does NOT neutralize full ref [foo][bar] WITH def for bar", () => {
    const nodes = classifyNodes("[bar]: https://example.com\n\nSee [foo][bar] here");
    const fullRefNode = nodes.find((n) => n.text.includes("[foo]"));
    expect(fullRefNode).toBeDefined();
    expect(fullRefNode!.neutralized).toBe(false);
  });

  it("neutralizes full ref [foo][bar] WITHOUT def for bar", () => {
    const nodes = classifyNodes("See [foo][bar] here");
    const fullRefNode = nodes.find((n) => n.text.includes("[foo]"));
    expect(fullRefNode).toBeDefined();
    expect(fullRefNode!.neutralized).toBe(true);
  });

  it("does NOT neutralize collapsed ref [foo][] WITH def for foo", () => {
    const nodes = classifyNodes("[foo]: https://example.com\n\nSee [foo][] here");
    const collapsedNode = nodes.find((n) => n.text.includes("[foo][]"));
    expect(collapsedNode).toBeDefined();
    expect(collapsedNode!.neutralized).toBe(false);
  });

  it("normalizes ref matching: [Foo Bar] matches [foo  bar]: url", () => {
    const nodes = classifyNodes("[foo  bar]: https://example.com\n\nSee [Foo Bar] here");
    const refNode = nodes.find((n) => n.text === "[Foo Bar]");
    expect(refNode).toBeDefined();
    expect(refNode!.neutralized).toBe(false);
  });

  it("does NOT neutralize citation [@key2024foo]", () => {
    const nodes = classifyNodes("See [@key2024foo] here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(false);
  });

  it("does NOT neutralize multi-citation [see @a, ch. 3]", () => {
    const nodes = classifyNodes("See [see @a, ch. 3] here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(false);
  });

  it("does NOT neutralize suppressed citation [-@a; @b]", () => {
    const nodes = classifyNodes("See [-@a; @b] here");
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.neutralized).toBe(false);
  });
});

describe("getRefDefLabels - doc-scan with WeakMap cache", () => {
  it("finds ref def at end of large doc on bare state (no ensureSyntaxTree)", () => {
    const filler = Array.from({ length: 20000 }, (_, i) => `filler line ${i} with some text`).join("\n");
    const doc = `[foo]\n\n${filler}\n\n[foo]: /target\n`;
    const state = makeState(doc);
    const labels = getRefDefLabels(state);
    expect(labels.has("foo")).toBe(true);
  });

  it("returns same Set instance for same state.doc (WeakMap cache)", () => {
    const state = makeState("[bar]: https://example.com\n\nsome text");
    const labels1 = getRefDefLabels(state);
    const labels2 = getRefDefLabels(state);
    expect(labels1).toBe(labels2);
  });

  it("returns new Set after doc edit", () => {
    const doc = "[bar]: https://example.com\n\nsome text";
    const state1 = makeState(doc);
    const labels1 = getRefDefLabels(state1);
    const state2 = state1.update({ changes: { from: doc.length, insert: "\nmore" } }).state;
    const labels2 = getRefDefLabels(state2);
    expect(labels2).not.toBe(labels1);
    expect(labels2.has("bar")).toBe(true);
  });

  it("does NOT count def-looking line inside fenced code block (divergence: fail-open)", () => {
    const state = makeState("```\n[foo]: /target\n```\n\nsome text");
    const labels = getRefDefLabels(state);
    expect(labels.has("foo")).toBe(true);
  });

  it("does NOT count mid-paragraph [foo]: x as a def", () => {
    const state = makeState("This is not a def [foo]: something in the middle.\n\ntext");
    const labels = getRefDefLabels(state);
    expect(labels.has("foo")).toBe(false);
  });

  it("collectRefDefLabels also uses doc-scan (backward compat)", () => {
    const filler = Array.from({ length: 20000 }, (_, i) => `filler line ${i}`).join("\n");
    const doc = `[bar]\n\n${filler}\n\n[bar]: /url\n`;
    const state = makeState(doc);
    const labels = collectRefDefLabels(state);
    expect(labels.has("bar")).toBe(true);
  });
});

describe("addPlainBracketDecos - image fallback slice (S5)", () => {
  it("does NOT neutralize ![foo] when def for 'foo' exists", () => {
    const state = makeState("[foo]: /target\n\n![foo]");
    const tree = syntaxTree(state);
    const refLabels = getRefDefLabels(state);
    const decos: { from: number; to: number; deco: Decoration }[] = [];
    tree.iterate({
      enter: (node) => {
        if (node.name === "Image") {
          addPlainBracketDecos(state, node.from, node.to, node.node, refLabels, decos);
          return false;
        }
      },
    });
    expect(decos.length).toBe(0);
  });

  it("neutralizes ![foo] when NO def for 'foo' exists", () => {
    const state = makeState("![foo]");
    const tree = syntaxTree(state);
    const refLabels = getRefDefLabels(state);
    const decos: { from: number; to: number; deco: Decoration }[] = [];
    tree.iterate({
      enter: (node) => {
        if (node.name === "Image") {
          addPlainBracketDecos(state, node.from, node.to, node.node, refLabels, decos);
          return false;
        }
      },
    });
    expect(decos.length).toBe(1);
  });

  it("image fallback path: stub node with ![foo] text and 'foo' def is NOT neutralized", () => {
    const doc = "![foo]";
    const state = makeState(doc);
    const stubNode = {
      getChildren: () => [] as { from: number; to: number }[],
      getChild: () => null,
    };
    const refLabels = new Set(["foo"]);
    const decos: { from: number; to: number; deco: Decoration }[] = [];
    addPlainBracketDecos(state, 0, 6, stubNode, refLabels, decos);
    expect(decos.length).toBe(0);
  });
});
