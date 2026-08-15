import type { EditorView } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";
import { resolveAnnotationScope, resolveAnnotationScopeWithMode } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";
import { effectiveAnnotationLang } from "../../lib/annotationLang";
import { frontmatterFacet } from "./crossref";
import { dispatchScopeHighlight, clearScopeHighlight } from "./scopeHighlight";

const generationMap = new WeakMap<EditorView, number>();

/**
 * Key of the annotation the pointer is currently hovering (per view). Kept
 * alongside the generation so a stale SIBLING leave (a mouseleave for an
 * annotation with a DIFFERENT `char_start:char_end` than the active hover,
 * e.g. enter-before-leave event ordering) cannot discard the active hover's
 * in-flight resolve or clear its highlight. A leave for the ACTIVE key still
 * invalidates and clears - same-key widget replacement clears too, unless a
 * new mouseenter re-arms hover.
 */
const activeKeyMap = new WeakMap<EditorView, string>();

function annotationKey(annotation: Annotation): string {
  return `${annotation.char_start}:${annotation.char_end}`;
}

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

  activeKeyMap.set(view, annotationKey(annotation));
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
    dispatchScopeHighlight(view, range.start, range.end);
  }
}

export function handleAnnotationLeave(view: EditorView, annotation: Annotation): void {
  const active = activeKeyMap.get(view);
  // Stale sibling leave: a leave for a DIFFERENT annotation key than the
  // active hover (enter-before-leave ordering). Do not invalidate that
  // hover's in-flight resolve or clear its highlight.
  if (active !== undefined && active !== annotationKey(annotation)) return;
  activeKeyMap.delete(view);
  bumpGen(view);
  clearScopeHighlight(view);
}
