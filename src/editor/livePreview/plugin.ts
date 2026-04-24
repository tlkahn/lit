import { type DecorationSet, EditorView } from "@codemirror/view";
import { ViewPlugin, type ViewUpdate, type PluginValue } from "@codemirror/view";
import { StateField, RangeSet } from "@codemirror/state";
import { buildDecorations, buildBlockReplacements, type BlockReplacementState } from "./decorations";
import { perfMark, perfMeasure } from "./perf";

class LivePreviewPluginValue implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    perfMark("livePreview:update:start");
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.transactions.some(tr => tr.effects.length > 0)) {
      this.decorations = buildDecorations(update.view);
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
