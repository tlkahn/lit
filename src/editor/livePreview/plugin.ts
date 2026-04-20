import { type DecorationSet } from "@codemirror/view";
import { ViewPlugin, type ViewUpdate, type PluginValue } from "@codemirror/view";
import { buildDecorations } from "./decorations";
import type { EditorView } from "@codemirror/view";

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
