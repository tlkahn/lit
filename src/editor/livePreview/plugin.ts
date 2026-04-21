import { type DecorationSet, EditorView } from "@codemirror/view";
import { ViewPlugin, type ViewUpdate, type PluginValue } from "@codemirror/view";
import { StateField, RangeSet } from "@codemirror/state";
import { buildDecorations, buildBlockReplacements } from "./decorations";

class LivePreviewPluginValue implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.transactions.some(tr => tr.effects.length > 0)) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPluginValue, {
  decorations: (v) => v.decorations,
});

export const blockReplacementField = StateField.define<DecorationSet>({
  create(state) {
    try {
      return buildBlockReplacements(state);
    } catch (e) {
      console.error("[blockReplacementField] create error:", e);
      return RangeSet.empty;
    }
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.length) {
      try {
        return buildBlockReplacements(tr.state);
      } catch (e) {
        console.error("[blockReplacementField] update error:", e);
        return RangeSet.empty;
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
