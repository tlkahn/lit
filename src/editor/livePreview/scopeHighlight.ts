import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export const setScopeHighlight = StateEffect.define<{ from: number; to: number } | null>();

const highlightMark = Decoration.mark({ class: "scope-highlight" });

export const scopeHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setScopeHighlight)) {
        if (e.value === null) return Decoration.none;
        const { from, to } = e.value;
        return Decoration.set([highlightMark.range(from, to)]);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function dispatchScopeHighlight(view: EditorView, from: number, to: number) {
  view.dispatch({ effects: setScopeHighlight.of({ from, to }) });
}

export function clearScopeHighlight(view: EditorView) {
  view.dispatch({ effects: setScopeHighlight.of(null) });
}

export function scopeHighlightExtension(): Extension {
  return scopeHighlightField;
}
