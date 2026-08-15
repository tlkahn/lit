import type { EditorView } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";
import { resolveAnnotationScope, resolveAnnotationScopeWithMode } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";
import { effectiveAnnotationLang } from "../../lib/annotationLang";
import { frontmatterFacet } from "./crossref";
import { dispatchScopeHighlight, clearScopeHighlight } from "./scopeHighlight";

const generationMap = new WeakMap<EditorView, number>();

/**
 * Identity of the annotation the pointer is currently hovering (per view).
 * Kept alongside the generation so a mouseleave from a DIFFERENT annotation's
 * widget (stale sibling leave: enter-before-leave event ordering, or a leave
 * fired by an old widget being destroyed) cannot discard the active hover's
 * in-flight resolve. A leave for the active annotation still invalidates and
 * clears, matching the pre-existing semantics.
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
  // Stale sibling leave: the pointer is logically on a DIFFERENT annotation
  // (its mouseenter already ran, or the leaving widget was destroyed). Do not
  // invalidate that hover's in-flight resolve or clear its highlight.
  if (active !== undefined && active !== annotationKey(annotation)) return;
  activeKeyMap.delete(view);
  bumpGen(view);
  clearScopeHighlight(view);
}
