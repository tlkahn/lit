import { type DecorationSet, EditorView } from "@codemirror/view";
import { ViewPlugin, type ViewUpdate, type PluginValue } from "@codemirror/view";
import { StateField, RangeSet } from "@codemirror/state";
import { buildDecorations, buildBlockReplacements, type BlockReplacementState } from "./decorations";
import { toggleCalloutEffect } from "./callout";
import { imageResolverFacet } from "./imageResolver";
import { mediaThumbnailsFacet } from "./mediaThumbnails";
import { isPerfEnabled, perfMark, perfMeasure } from "./perf";

class LivePreviewPluginValue implements PluginValue {
  decorations: DecorationSet;
  cursorSensitiveLines: Set<number>;

  constructor(view: EditorView) {
    const result = buildDecorations(view);
    this.decorations = result.decorations;
    this.cursorSensitiveLines = result.cursorSensitiveLines;
  }

  private rebuild(view: EditorView, reason: string) {
    if (isPerfEnabled()) {
      perfMark("livePreview:rebuild:start");
    }
    const result = buildDecorations(view);
    this.decorations = result.decorations;
    this.cursorSensitiveLines = result.cursorSensitiveLines;
    if (isPerfEnabled()) {
      const m = perfMeasure("livePreview:rebuild", "livePreview:rebuild:start");
      console.debug(`[livePreview] rebuild (${reason}) ${m ? m.duration.toFixed(1) + "ms" : ""}`);
    }
  }

  update(update: ViewUpdate) {
    perfMark("livePreview:update:start");
    if (update.docChanged || update.viewportChanged) {
      this.rebuild(update.view, update.docChanged ? "docChanged" : "viewportChanged");
    } else if (update.transactions.some(tr => tr.effects.some(e => e.is(toggleCalloutEffect)))) {
      this.rebuild(update.view, "toggleEffect");
    } else if (
      update.startState.facet(imageResolverFacet) !== update.state.facet(imageResolverFacet) ||
      update.startState.facet(mediaThumbnailsFacet) !== update.state.facet(mediaThumbnailsFacet)
    ) {
      this.rebuild(update.view, "facet changed");
    } else if (update.selectionSet) {
      const oldLine = update.startState.doc.lineAt(update.startState.selection.main.head).number;
      const newLine = update.state.doc.lineAt(update.state.selection.main.head).number;
      if (this.cursorSensitiveLines.has(oldLine) || this.cursorSensitiveLines.has(newLine)) {
        this.rebuild(update.view, `selection L${oldLine}→L${newLine} (sensitive)`);
      } else if (isPerfEnabled()) {
        console.debug(`[livePreview] skip: selection L${oldLine}→L${newLine} (plain)`);
        perfMark("livePreview:skip:selection");
      }
    } else if (isPerfEnabled()) {
      console.debug("[livePreview] skip: no trigger");
      perfMark("livePreview:skip:no-trigger");
    }
    perfMeasure("livePreview:update", "livePreview:update:start");
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPluginValue, {
  decorations: (v) => v.decorations,
});

function findContainingBlock(
  lineNum: number,
  ranges: Array<{ fromLine: number; toLine: number }>,
): number {
  for (let i = 0; i < ranges.length; i++) {
    if (lineNum >= ranges[i]!.fromLine && lineNum <= ranges[i]!.toLine) return i;
  }
  return -1;
}

const emptyBlockState: BlockReplacementState = {
  decos: RangeSet.empty,
  cursorSensitiveRanges: [],
};

export const blockReplacementField = StateField.define<BlockReplacementState>({
  create(state) {
    try {
      return buildBlockReplacements(state);
    } catch (e) {
      console.error("[blockReplacementField] create error:", e);
      return emptyBlockState;
    }
  },
  update(value, tr) {
    if (tr.docChanged || tr.effects.length) {
      try {
        return buildBlockReplacements(tr.state);
      } catch (e) {
        console.error("[blockReplacementField] update error:", e);
        return emptyBlockState;
      }
    }
    if (tr.selection) {
      const oldLine = tr.startState.doc.lineAt(tr.startState.selection.main.head).number;
      const newLine = tr.state.doc.lineAt(tr.state.selection.main.head).number;
      if (oldLine === newLine) return value;
      const oldBlock = findContainingBlock(oldLine, value.cursorSensitiveRanges);
      const newBlock = findContainingBlock(newLine, value.cursorSensitiveRanges);
      if (oldBlock === newBlock) return value;
      try {
        return buildBlockReplacements(tr.state);
      } catch (e) {
        console.error("[blockReplacementField] update error:", e);
        return emptyBlockState;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, val => val.decos),
});
