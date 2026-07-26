import { type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { resolveMarkScopes, type ScopeRange } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";
import {
  effectiveAnnotationLang,
  normalizeLang,
} from "../../lib/annotationLang";
import { annotationDataField, setAnnotationData } from "./annotationState";
import { frontmatterFacet } from "./crossref";

/** A resolved mark span: a document range plus the mark code driving its CSS class. */
export interface MarkRange {
  from: number;
  to: number;
  code: string;
}

export const setMarkDecorations = StateEffect.define<MarkRange[]>();

/**
 * Holds the persistent mark decorations. Rebuilds from the latest
 * `setMarkDecorations` effect and remaps positions on every doc change so the
 * spans track edits between async re-resolutions.
 */
export const markDecorationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setMarkDecorations)) {
        if (e.value.length === 0) return Decoration.none;
        const ranges = e.value
          .filter((r) => r.from < r.to)
          .sort((a, b) => a.from - b.from || a.to - b.to)
          .map((r) => Decoration.mark({ class: `cm-mark cm-mark-${r.code}` }).range(r.from, r.to));
        if (ranges.length === 0) return Decoration.none;
        return Decoration.set(ranges, true);
      }
    }
    if (tr.docChanged) {
      const mapped = value.map(tr.changes);
      const kept: Range<Decoration>[] = [];
      const iter = mapped.iter();
      while (iter.value) {
        if (iter.from < iter.to) kept.push(iter.value.range(iter.from, iter.to));
        iter.next();
      }
      return kept.length ? Decoration.set(kept, true) : Decoration.none;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const DEBOUNCE_MS = 150;

/**
 * Watches `annotationDataField` for mark-type annotations, resolves all their
 * scopes in a single batched `resolveMarkScopes` IPC call, and dispatches
 * `setMarkDecorations`. Stale async results are discarded via a per-view
 * generation counter, mirroring the pattern in `annotationHover.ts`.
 */
const markScopePlugin = ViewPlugin.fromClass(
  class {
    private generation = 0;
    private debounceTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private view: EditorView) {
      this.schedule();
    }

    update(update: ViewUpdate) {
      const dataChanged = update.transactions.some((t) =>
        t.effects.some((e) => e.is(setAnnotationData)),
      );
      if (dataChanged || update.docChanged) this.schedule();
    }

    private schedule() {
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.resolveAll();
      }, DEBOUNCE_MS);
    }

    private async resolveAll() {
      const generation = ++this.generation;
      const content = this.view.state.doc.toString();

      const marks = this.view.state
        .field(annotationDataField)
        .filter((ann) => ann.annotation_type === "mark" && !!ann.mark);

      if (marks.length === 0) {
        if (this.generation === generation) {
          const prev = this.view.state.field(markDecorationField);
          if (prev !== Decoration.none) {
            this.view.dispatch({ effects: setMarkDecorations.of([]) });
          }
        }
        return;
      }

      // Document language is the batch fallback; a mark carrying its own
      // `lang=` overrides it per mark on the Rust side (#854).
      const lang = effectiveAnnotationLang(
        null,
        this.view.state.facet(frontmatterFacet),
        usePreferencesStore.getState().annotationDefaultLang,
      );
      const requests = marks.map((ann) => {
        const markLang = normalizeLang(ann.lang);
        return {
          charStart: ann.char_start,
          scope: ann.scope,
          ...(markLang ? { lang: markLang } : {}),
        };
      });

      let results: Array<ScopeRange | null>;
      try {
        results = await resolveMarkScopes(content, requests, lang);
      } catch {
        return;
      }

      if (this.generation !== generation) return;
      if (this.view.state.doc.toString() !== content) return;

      const ranges = marks.flatMap((ann, i) => {
        const range = results[i];
        return range && range.start < range.end
          ? [{ from: range.start, to: range.end, code: ann.mark! }]
          : [];
      });
      this.view.dispatch({ effects: setMarkDecorations.of(ranges) });
    }

    destroy() {
      if (this.debounceTimer != null) clearTimeout(this.debounceTimer);
    }
  },
);

export function markDecorationExtension(): Extension {
  return [markDecorationField, markScopePlugin];
}
