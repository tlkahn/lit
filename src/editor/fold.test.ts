import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { foldable } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { WikiLink } from "./markdown/wikilink";
import { Frontmatter, FrontmatterYamlWrap } from "./markdown/frontmatter";
import { Math } from "./markdown/math";
import { Comment } from "./markdown/comment";
import { foldExtension } from "./fold";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));

vi.mock("katex/dist/katex.min.css", () => ({}));

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        extensions: [GFM, WikiLink, Frontmatter, FrontmatterYamlWrap, Math, Comment],
      }),
      foldExtension(),
    ],
  });
}

function getFoldRange(state: EditorState, lineNumber: number) {
  const line = state.doc.line(lineNumber);
  return foldable(state, line.from, line.to);
}

describe("fold ranges", () => {
  describe("headings", () => {
    it("H2 folds from end of heading line to just before next H2", () => {
      const state = makeState(
        "## Section A\nContent A\n## Section B\nContent B",
      );
      const range = getFoldRange(state, 1);
      expect(range).not.toBeNull();
      expect(range!.from).toBe(state.doc.line(1).to);
      expect(range!.to).toBe(state.doc.line(2).to);
    });

    it("H2 fold includes nested H3/H4 (Obsidian-style)", () => {
      const state = makeState(
        "## Section\n### Sub\nContent\n#### Deep\nMore\n## Next",
      );
      const range = getFoldRange(state, 1);
      expect(range).not.toBeNull();
      expect(range!.from).toBe(state.doc.line(1).to);
      expect(range!.to).toBe(state.doc.line(5).to);
    });

    it("H1 at end of doc folds to end of document", () => {
      const state = makeState("# Title\nSome content\nMore content");
      const range = getFoldRange(state, 1);
      expect(range).not.toBeNull();
      expect(range!.from).toBe(state.doc.line(1).to);
      expect(range!.to).toBe(state.doc.length);
    });

    it("heading with no content after it returns null", () => {
      const state = makeState("## Empty");
      const range = getFoldRange(state, 1);
      expect(range).toBeNull();
    });
  });

  describe("fenced code blocks", () => {
    it("fenced code block is foldable", () => {
      const state = makeState("```js\nconsole.log('hi')\n```");
      const range = getFoldRange(state, 1);
      expect(range).not.toBeNull();
      expect(range!.from).toBe(state.doc.line(1).to);
      expect(range!.to).toBe(state.doc.length);
    });
  });

  describe("frontmatter", () => {
    it("frontmatter is foldable", () => {
      const state = makeState("---\ntitle: Test\ntags: [a, b]\n---\n\n# Hello");
      const range = getFoldRange(state, 1);
      expect(range).not.toBeNull();
      expect(range!.from).toBe(state.doc.line(1).to);
      const closingLine = state.doc.line(4);
      expect(range!.to).toBe(closingLine.to);
    });
  });

  describe("non-foldable lines", () => {
    it("single-line paragraph is not foldable", () => {
      const state = makeState("Just a paragraph.");
      const range = getFoldRange(state, 1);
      expect(range).toBeNull();
    });
  });
});
