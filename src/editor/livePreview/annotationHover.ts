import type { EditorView } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";
import { resolveAnnotationScope, resolveAnnotationScopeWithMode } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";
import { dispatchScopeHighlight, clearScopeHighlight } from "./scopeHighlight";

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
  const lang = prefs.annotationDefaultLang;

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

export function handleAnnotationLeave(view: EditorView): void {
  bumpGen(view);
  clearScopeHighlight(view);
}
