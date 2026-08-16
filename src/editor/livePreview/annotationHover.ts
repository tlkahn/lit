import type { EditorView } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";
import { resolveAnnotationScope, resolveAnnotationScopeWithMode } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";
import { effectiveAnnotationLang } from "../../lib/annotationLang";
import { frontmatterFacet } from "./crossref";
import {
  dispatchScopeHighlightRanges,
  clearScopeHighlight,
  clipRangeToVisible,
} from "./scopeHighlight";
import { annotationDataField } from "./annotationState";

const generationMap = new WeakMap<EditorView, number>();

function getGen(view: EditorView): number {
  return generationMap.get(view) ?? 0;
}

function bumpGen(view: EditorView): number {
  const n = getGen(view) + 1;
  generationMap.set(view, n);
  return n;
}

export interface HoverOpts {
  altKey?: boolean;
}

export async function handleAnnotationHover(
  view: EditorView,
  annotation: Annotation,
  opts?: HoverOpts,
): Promise<void> {
  const prefs = usePreferencesStore.getState();
  if (!prefs.annotationScopeHighlight) return;

  const generation = bumpGen(view);
  const content = view.state.doc.toString();
  const lang = effectiveAnnotationLang(
    annotation.lang,
    view.state.facet(frontmatterFacet),
    prefs.annotationDefaultLang,
  );

  let range: { start: number; end: number } | null;
  try {
    if (opts?.altKey) {
      range = await resolveAnnotationScopeWithMode(
        content,
        annotation.char_start,
        annotation.scope,
        lang,
        "bidirectional",
      );
    } else {
      range = await resolveAnnotationScope(
        content,
        annotation.char_start,
        annotation.scope,
        lang,
      );
    }
  } catch {
    return;
  }

  if (getGen(view) !== generation) return;
  if (!range) return;

  if (range.start < range.end) {
    // Subtract annotation replace spans (char_start..char_end from
    // annotationDataField) so marks land only on visible prose. Defense in
    // depth: CM6 already suppresses marks on replaced text, and core resolve
    // is the source of truth for prose attachment (#1028); clipping keeps
    // multi-segment paint explicit and independent of replace-widget details.
    // A range fully hidden behind widgets clips to empty: clear explicitly
    // rather than guessing a fallback prose range.
    const spans = (view.state.field(annotationDataField, false) ?? [])
      .filter((a) => a.char_start < a.char_end)
      .map((a) => ({ from: a.char_start, to: a.char_end }));
    const segments = clipRangeToVisible(range.start, range.end, spans);
    if (segments.length === 0) {
      clearScopeHighlight(view);
      return;
    }
    dispatchScopeHighlightRanges(view, segments);
  }
}

export function handleAnnotationLeave(view: EditorView): void {
  bumpGen(view);
  clearScopeHighlight(view);
}
