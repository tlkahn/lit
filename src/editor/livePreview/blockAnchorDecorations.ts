import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { extractBlockAnchors, type BlockAnchor } from "../../lib/blockAnchors";
import { isCursorOnLine } from "./proximity";

const dimMark = Decoration.mark({ class: "cm-block-anchor-dim" });

/**
 * Dim decorations for the anchors intersecting `ranges` (typically the
 * visible ranges), skipping the cursor line. Anchors are extracted from the
 * FULL document so fence state stays correct when a code fence opens above
 * the first range — a per-range scan would start with `inFence = false` and
 * dim `^id` lines inside that fence.
 */
export function computeDimRanges(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  anchors: readonly BlockAnchor[] = extractBlockAnchors(state.doc.toString()),
): Range<Decoration>[] {
  const out: Range<Decoration>[] = [];
  for (const anchor of anchors) {
    if (!ranges.some((r) => anchor.from <= r.to && anchor.to >= r.from)) continue;
    if (isCursorOnLine(state, anchor.from, anchor.to)) continue;
    out.push(dimMark.range(anchor.from, anchor.to));
  }
  return out;
}

function anchorLineNumbers(state: EditorState, anchors: readonly BlockAnchor[]): Set<number> {
  const lines = new Set<number>();
  for (const anchor of anchors) {
    lines.add(state.doc.lineAt(anchor.from).number);
  }
  return lines;
}

// Exported for tests (decoration-reference stability assertions).
export const blockAnchorDimPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    private anchors: readonly BlockAnchor[];
    private anchorLines: Set<number>;

    constructor(view: EditorView) {
      this.anchors = extractBlockAnchors(view.state.doc.toString());
      this.anchorLines = anchorLineNumbers(view.state, this.anchors);
      this.decorations = this.build(view);
    }

    private build(view: EditorView): DecorationSet {
      return Decoration.set(computeDimRanges(view.state, view.visibleRanges, this.anchors), true);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.anchors = extractBlockAnchors(update.state.doc.toString());
        this.anchorLines = anchorLineNumbers(update.state, this.anchors);
        this.decorations = this.build(update.view);
      } else if (update.viewportChanged) {
        this.decorations = this.build(update.view);
      } else if (update.selectionSet) {
        // Only anchor lines are cursor-sensitive: rebuild solely when the
        // cursor enters or leaves one (mirrors the livePreview plugin guard).
        const oldLine = update.startState.doc.lineAt(update.startState.selection.main.head).number;
        const newLine = update.state.doc.lineAt(update.state.selection.main.head).number;
        if (this.anchorLines.has(oldLine) || this.anchorLines.has(newLine)) {
          this.decorations = this.build(update.view);
        }
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function blockAnchorDecorationsExtension(): Extension {
  return blockAnchorDimPlugin;
}
