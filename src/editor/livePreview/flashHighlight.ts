import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export const setFlashHighlight = StateEffect.define<{ from: number; to: number } | null>();

const flashMark = Decoration.mark({ class: "cm-block-flash" });

export const flashHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setFlashHighlight)) {
        if (e.value === null) return Decoration.none;
        const { from, to } = e.value;
        if (from >= to) return Decoration.none;
        return Decoration.set([flashMark.range(from, to)]);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function flashHighlightExtension(): Extension {
  return flashHighlightField;
}
