import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { calloutFoldField } from "./callout";
import { livePreviewPlugin, blockReplacementField } from "./plugin";
import {
  generateProse,
  generateDecorationHeavy,
  generateWidgetHeavy,
  generateDeeplyNested,
} from "../../test/fixtures/generate";

vi.mock("katex", () => ({
  default: {
    render: vi.fn((tex: string, el: HTMLElement) => {
      el.textContent = tex;
    }),
  },
}));
vi.mock("katex/dist/katex.min.css", () => ({}));
vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: "<svg/>" })) },
}));
vi.mock("./mermaid", () => ({
  renderMermaid: vi.fn(async () => {}),
  getMermaidCached: vi.fn(() => undefined),
}));

const LINES = 1000;
const HARD_LIMIT_MS = 100;
const ADVISORY_MS = 16;

const docs = {
  prose: generateProse(LINES),
  decorationHeavy: generateDecorationHeavy(LINES),
  widgetHeavy: generateWidgetHeavy(LINES),
  deeplyNested: generateDeeplyNested(LINES),
} as const;

function makeView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions: [
      markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
      calloutFoldField,
      livePreviewPlugin,
      blockReplacementField,
    ],
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

function measureDispatch(
  view: EditorView,
  change: { from: number; to?: number; insert?: string },
): number {
  const start = performance.now();
  view.dispatch({ changes: change });
  return performance.now() - start;
}

describe("keystroke latency — single char insert at midpoint", () => {
  for (const [name, doc] of Object.entries(docs)) {
    it(`${name} (${LINES} lines)`, () => {
      const view = makeView(doc);
      const mid = Math.floor(doc.length / 2);
      const elapsed = measureDispatch(view, { from: mid, insert: "x" });

      if (elapsed > ADVISORY_MS) {
        console.warn(
          `[perf] ${name} midpoint insert: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
        );
      }
      expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
      view.destroy();
    });
  }
});

describe("keystroke latency — char insert at document start", () => {
  for (const [name, doc] of Object.entries(docs)) {
    it(`${name} (${LINES} lines)`, () => {
      const view = makeView(doc);
      const elapsed = measureDispatch(view, { from: 0, insert: "x" });

      if (elapsed > ADVISORY_MS) {
        console.warn(
          `[perf] ${name} start insert: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
        );
      }
      expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
      view.destroy();
    });
  }
});

describe("keystroke latency — backspace deletion", () => {
  for (const [name, doc] of Object.entries(docs)) {
    it(`${name} (${LINES} lines)`, () => {
      const view = makeView(doc);
      const mid = Math.floor(doc.length / 2);
      const elapsed = measureDispatch(view, { from: mid, to: mid + 1 });

      if (elapsed > ADVISORY_MS) {
        console.warn(
          `[perf] ${name} backspace: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
        );
      }
      expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
      view.destroy();
    });
  }
});

describe("keystroke latency — 100-char paste", () => {
  for (const [name, doc] of Object.entries(docs)) {
    it(`${name} (${LINES} lines)`, () => {
      const view = makeView(doc);
      const mid = Math.floor(doc.length / 2);
      const paste = "x".repeat(100);
      const elapsed = measureDispatch(view, { from: mid, insert: paste });

      if (elapsed > ADVISORY_MS) {
        console.warn(
          `[perf] ${name} paste: ${elapsed.toFixed(1)}ms (>${ADVISORY_MS}ms target)`,
        );
      }
      expect(elapsed).toBeLessThan(HARD_LIMIT_MS);
      view.destroy();
    });
  }
});
