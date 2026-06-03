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
): void {
  const dsl = buildCompanionDsl(responseText);
  view.dispatch({
    changes: {
      from: sourceAnnotation.char_end,
      to: sourceAnnotation.char_end,
      insert: "\n\n" + dsl,
    },
  });
}

export function insertCompanionAtCursor(
  view: EditorView,
  responseText: string,
): void {
  const dsl = buildCompanionDsl(responseText);
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: "\n\n" + dsl },
  });
}
