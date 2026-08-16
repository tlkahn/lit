import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export const setScopeHighlight = StateEffect.define<{ from: number; to: number } | null>();

export type CharRange = { from: number; to: number };

/**
 * Subtract replaced/annotation spans from `[from, to)`. Returns sorted,
 * non-empty visible segments (gaps between replaced spans). A range fully
 * hidden behind replaced spans yields `[]`.
 */
export function clipRangeToVisible(
  from: number,
  to: number,
  replaced: readonly CharRange[],
): CharRange[] {
  if (from >= to) return [];

  // Replaced spans overlapping [from, to), clamped and sorted by from.
  const overlaps: CharRange[] = [];
  for (const s of replaced) {
    if (s.from >= to || s.to <= from) continue;
    overlaps.push({ from: Math.max(s.from, from), to: Math.min(s.to, to) });
  }
  if (overlaps.length === 0) return [{ from, to }];
  overlaps.sort((a, b) => a.from - b.from);

  const segments: CharRange[] = [];
  let cursor = from;
  for (const s of overlaps) {
    if (s.from > cursor) {
      segments.push({ from: cursor, to: s.from });
    }
    if (s.to > cursor) cursor = s.to;
  }
  if (cursor < to) {
    segments.push({ from: cursor, to });
  }
  return segments;
}

const highlightMark = Decoration.mark({ class: "scope-highlight" });

export const scopeHighlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setScopeHighlight)) {
        if (e.value === null) return Decoration.none;
        const { from, to } = e.value;
        if (from >= to) return Decoration.none;
        return Decoration.set([highlightMark.range(from, to)]);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function dispatchScopeHighlight(view: EditorView, from: number, to: number) {
  if (from >= to) return;
  view.dispatch({ effects: setScopeHighlight.of({ from, to }) });
}

export function clearScopeHighlight(view: EditorView) {
  view.dispatch({ effects: setScopeHighlight.of(null) });
}

export function scopeHighlightExtension(): Extension {
  return scopeHighlightField;
}
