import type { EditorView } from "@codemirror/view";
import type { Annotation } from "../../lib/ipc";
import { resolveAnnotationScope } from "../../lib/ipc";
import { usePreferencesStore } from "../../stores/preferences";
import { dispatchScopeHighlight, clearScopeHighlight } from "./scopeHighlight";

let hoverGeneration = 0;

export function getHoverGeneration(): number {
  return hoverGeneration;
}

export async function handleAnnotationHover(
  view: EditorView,
  annotation: Annotation,
): Promise<void> {
  const generation = ++hoverGeneration;
  const content = view.state.doc.toString();
  const lang = usePreferencesStore.getState().annotationDefaultLang;

  const range = await resolveAnnotationScope(
    content,
    annotation.char_start,
    annotation.scope,
    lang,
  );

  if (hoverGeneration !== generation) return;
  if (!range) return;

  dispatchScopeHighlight(view, range.start, range.end);
}

export function handleAnnotationLeave(view: EditorView): void {
  hoverGeneration++;
  clearScopeHighlight(view);
}

export function resetHoverGeneration(): void {
  hoverGeneration = 0;
}
