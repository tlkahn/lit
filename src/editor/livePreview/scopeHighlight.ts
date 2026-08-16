import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

export const setScopeHighlight = StateEffect.define<CharRange[] | null>();

export type CharRange = { from: number; to: number };

/**
 * Subtract replaced/annotation spans from `[from, to)`. Returns sorted,
 * non-empty visible segments (gaps between replaced spans). A range fully
 * hidden behind replaced spans yields `[]`.
 *
 * Defense in depth, not a correctness layer: core resolve (lit-annotation-core)
 * is the source of truth for prose attachment (#1028); this only guarantees
 * marks never paint inside block-widget chrome even if a future caller feeds a
 * range that straddles replaced spans, and keeps the explicit-empty clear path.
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
        if (e.value === null || e.value.length === 0) return Decoration.none;
        const ranges: Array<{ from: number; to: number }> = [];
        for (const r of e.value) {
          if (r.from < r.to) ranges.push(r);
        }
        if (ranges.length === 0) return Decoration.none;
        // `sort = true`: the public multi-range `Decoration.set` throws on
        // unsorted input; clip callers can produce out-of-order segments.
        return Decoration.set(ranges.map((r) => highlightMark.range(r.from, r.to)), true);
      }
    }
    if (tr.docChanged) return Decoration.none;
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function dispatchScopeHighlight(view: EditorView, from: number, to: number) {
  if (from >= to) return;
  dispatchScopeHighlightRanges(view, [{ from, to }]);
}

export function dispatchScopeHighlightRanges(view: EditorView, ranges: CharRange[]) {
  view.dispatch({ effects: setScopeHighlight.of(ranges) });
}

export function clearScopeHighlight(view: EditorView) {
  view.dispatch({ effects: setScopeHighlight.of(null) });
}

export function scopeHighlightExtension(): Extension {
  return scopeHighlightField;
}
