import type { ChangeSpec, StateEffect } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Annotation, Scope } from "./ipc";
import { annotationToFields, generateDsl } from "./annotationDsl";
import { serializeThreadBody } from "./threadBody";

/**
 * Transform a fired source annotation into a thread DSL string.
 *
 * The source annotation's scope is inherited, its question (the prompt that was
 * fired) becomes the first `[q]:` turn, and `responseText` becomes that turn's
 * response. A fresh UUID is generated for traceability.
 *
 * First-turn question resolution by source type:
 *   - translation -> "Translate" (the scope text is the implicit input)
 *   - llm with empty/whitespace/null body -> "Explain" (the scope text the
 *     llm acted on is NOT available here — buildThreadDsl only receives the
 *     source annotation and response — so a fixed verb stands in)
 *   - otherwise -> the source body, or "Answer" when the body is empty/whitespace
 */
export function buildThreadDsl(sourceAnnotation: Annotation, responseText: string): string {
  const scope = annotationToFields(sourceAnnotation).scope;

  const sourceBody = (sourceAnnotation.body ?? "").trim();
  let question: string;
  if (sourceAnnotation.annotation_type === "translation") {
    question = "Translate";
  } else if (sourceAnnotation.annotation_type === "llm" && sourceBody === "") {
    question = "Explain";
  } else {
    question = sourceBody || "Answer";
  }

  const body = serializeThreadBody([{ question, response: responseText }]);
  const id = crypto.randomUUID();

  return generateDsl({
    id,
    type: "thread",
    certainty: "neutral",
    scope,
    body,
    date: null,
  });
}

export function buildCompanionDsl(responseText: string, scope?: Scope | null): string {
  return generateDsl({
    id: null,
    type: "note",
    certainty: "neutral",
    scope: scope ?? null,
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
  const inheritedScope = annotationToFields(sourceAnnotation).scope;
  const dsl = buildCompanionDsl(responseText, inheritedScope);
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
