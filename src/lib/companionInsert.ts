import type { ChangeSpec, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { generateDsl } from "./annotationDsl";

export function buildCompanionDsl(responseText: string): string {
  return generateDsl({
    id: null,
    type: "note",
    certainty: "neutral",
    scope: null,
    body: responseText,
    date: null,
  });
}

export function insertCompanionAnnotation(
  view: EditorView,
  sourceAnnotation: Annotation,
  responseText: string,
  options?: { removeSource?: boolean; effects?: StateEffect<unknown>[] },
): void {
  const dsl = buildCompanionDsl(responseText);
  const changes: ChangeSpec[] = [];
  if (options?.removeSource) {
    changes.push({ from: sourceAnnotation.char_start, to: sourceAnnotation.char_end });
  }
  const prefix = options?.removeSource && sourceAnnotation.char_start === 0 ? "" : "\n\n";
  changes.push({
    from: sourceAnnotation.char_end,
    to: sourceAnnotation.char_end,
    insert: prefix + dsl + "\n",
  });
  view.dispatch({ changes, effects: options?.effects });
}

export function insertCompanionAtCursor(
  view: EditorView,
  responseText: string,
): void {
  const dsl = buildCompanionDsl(responseText);
  const pos = view.state.selection.main.to;
  const prefix = pos === 0 ? "" : "\n\n";
  view.dispatch({
    changes: { from: pos, insert: prefix + dsl + "\n" },
  });
  view.focus();
}
