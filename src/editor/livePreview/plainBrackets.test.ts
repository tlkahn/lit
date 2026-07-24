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
import { normalizeRefLabel, collectRefDefLabels, addPlainBracketDecos } from "./plainBrackets";

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
