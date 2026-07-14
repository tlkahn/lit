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

const pendingTimers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

export function dispatchFlashHighlight(
  view: EditorView,
  from: number,
  to: number,
  durationMs = 1200,
) {
  if (from >= to) return;
  const prev = pendingTimers.get(view);
  if (prev !== undefined) clearTimeout(prev);
  view.dispatch({ effects: setFlashHighlight.of({ from, to }) });
  const timer = setTimeout(() => {
    pendingTimers.delete(view);
    // CM6 turns dispatch on a destroyed view into a state-only no-op,
    // so a flash outliving its editor is harmless.
    view.dispatch({ effects: setFlashHighlight.of(null) });
  }, durationMs);
  pendingTimers.set(view, timer);
}

export function flashHighlightExtension(): Extension {
  return flashHighlightField;
}
