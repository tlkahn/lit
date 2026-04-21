import { type DecorationSet, EditorView } from "@codemirror/view";
import { ViewPlugin, type ViewUpdate, type PluginValue } from "@codemirror/view";
import { StateField } from "@codemirror/state";
import { buildDecorations, buildBlockReplacements } from "./decorations";

class LivePreviewPluginValue implements PluginValue {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const livePreviewPlugin = ViewPlugin.fromClass(LivePreviewPluginValue, {
  decorations: (v) => v.decorations,
});

export const blockReplacementField = StateField.define<DecorationSet>({
  create(state) {
    return buildBlockReplacements(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection || tr.effects.length) {
      return buildBlockReplacements(tr.state);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
