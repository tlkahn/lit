import { bench, describe, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { buildDecorations, buildBlockReplacements } from "./decorations";
import { WikiLink } from "../markdown/wikilink";
import { Math as MathExt } from "../markdown/math";
import { Comment as CommentExt } from "../markdown/comment";
import { calloutFoldField } from "./callout";
import {
  generateProse,
  generateDecorationHeavy,
  generateWidgetHeavy,
  generateDeeplyNested,
} from "../../test/fixtures/generate";

// KaTeX and Mermaid are mocked — bench results under-count widget creation cost.
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

const docs = {
  prose: generateProse(LINES),
  decorationHeavy: generateDecorationHeavy(LINES),
  widgetHeavy: generateWidgetHeavy(LINES),
  deeplyNested: generateDeeplyNested(LINES),
} as const;

const extensions = [
  markdown({ extensions: [GFM, WikiLink, MathExt, CommentExt] }),
  calloutFoldField,
];

function makeView(doc: string): EditorView {
  const state = EditorState.create({
    doc,
    selection: { anchor: 0 },
    extensions,
  });
  return new EditorView({ state, parent: document.createElement("div") });
}

// In jsdom, view.visibleRanges spans the full document — this is worst-case
// measurement. Real performance will be better since CM6 only decorates the viewport.

describe("buildDecorations", () => {
  for (const [name, doc] of Object.entries(docs)) {
    const view = makeView(doc);
    bench(name, () => {
      buildDecorations(view);
    });
  }
});

describe("buildBlockReplacements", () => {
  for (const [name, doc] of Object.entries(docs)) {
    const state = EditorState.create({
      doc,
      selection: { anchor: 0 },
      extensions,
    });
    bench(name, () => {
      buildBlockReplacements(state);
    });
  }
});

describe("full transaction cycle", () => {
  for (const [name, doc] of Object.entries(docs)) {
    const view = makeView(doc);
    bench(name, () => {
      const pos = Math.min(100, view.state.doc.length);
      view.dispatch({ changes: { from: pos, insert: "x" } });
    });
  }
});
