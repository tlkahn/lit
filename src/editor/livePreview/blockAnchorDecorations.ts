import type { Extension, Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { extractBlockAnchors } from "../../lib/blockAnchors";
import { isCursorOnLine } from "./proximity";

const dimMark = Decoration.mark({ class: "cm-block-anchor-dim" });

function buildDimDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const ranges: Range<Decoration>[] = [];
  for (const range of view.visibleRanges) {
    // Snap to whole lines so the end-of-line anchor grammar and fence
    // tracking see complete lines, not a mid-line slice.
    const from = state.doc.lineAt(range.from).from;
    const to = state.doc.lineAt(range.to).to;
    const text = state.doc.sliceString(from, to);
    for (const anchor of extractBlockAnchors(text)) {
      const anchorFrom = from + anchor.from;
      const anchorTo = from + anchor.to;
      if (isCursorOnLine(state, anchorFrom, anchorTo)) continue;
      ranges.push(dimMark.range(anchorFrom, anchorTo));
    }
  }
  return Decoration.set(ranges, true);
}

const blockAnchorDimPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDimDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDimDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

export function blockAnchorDecorationsExtension(): Extension {
  return blockAnchorDimPlugin;
}
