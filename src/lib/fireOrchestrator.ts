import type { EditorView } from "@codemirror/view";
import type { Annotation, AnnotationType } from "./ipc";
import { resolveAnnotationScopeWithMode } from "./ipc";
import { startLlmStream } from "./llmClient";
import { classifyFireType } from "./fireClassification";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { useLlmResponseStore } from "../stores/llmResponse";
import { setFiringAnnotation, clearFiringAnnotation } from "../editor/livePreview/annotationWidgets";

export interface FireAnnotationArgs {
  view: EditorView;
  annotation: Annotation;
}

const PROMPT_FIELD_MAP: Partial<Record<AnnotationType, keyof PreferencesState>> = {
  llm: "llmPromptLlm",
  todo: "llmPromptTodo",
  translation: "llmPromptTr",
  question: "llmPromptQ",
  note: "llmPromptN",
  crossref: "llmPromptCf",
  apparatus: "llmPromptApp",
};

export function getTypePrompt(annotationType: AnnotationType): string {
  const field = PROMPT_FIELD_MAP[annotationType];
  if (!field) return "";
  return (usePreferencesStore.getState()[field] as string) ?? "";
}

export function buildFirePrompt(scopeText: string, body: string | null): string {
  const parts: string[] = [];
  if (scopeText) parts.push(scopeText);
  if (body) parts.push(body);
  return parts.join("\n\n");
}

export async function fireAnnotation(args: FireAnnotationArgs): Promise<void> {
  const { view, annotation } = args;

  if (useModalLockStore.getState().llmLocked) {
    throw new Error("LLM is already streaming");
  }

  useModalLockStore.getState().setLlmLocked(true);
  view.dispatch({ effects: setFiringAnnotation.of(annotation.char_start) });
  window.dispatchEvent(new CustomEvent("lit:fire-started", { detail: { annotation } }));

  const prefs = usePreferencesStore.getState();
  const doc = view.state.doc.toString();
  const lang = prefs.annotationDefaultLang;

  let scopeText = "";
  try {
    const range = await resolveAnnotationScopeWithMode(
      doc,
      annotation.char_start,
      annotation.scope,
      lang,
      "bidirectional",
    );
    if (range) {
      scopeText = doc.slice(range.start, range.end);
    }
  } catch (err) {
    console.warn("Scope resolution failed, proceeding with empty scope:", err);
  }

  const system = getTypePrompt(annotation.annotation_type);
  const text = buildFirePrompt(scopeText, annotation.body);
  const fireType = classifyFireType(annotation.annotation_type);

  useLlmResponseStore.getState().startStream({
    question: annotation.body ?? "",
    fireSourceAnnotation: fireType === "persisting" ? annotation : undefined,
  });

  await startLlmStream(
    { model: prefs.llmModel, text, system: system || undefined },
    {
      onChunk: (chunk) => useLlmResponseStore.getState().appendChunk(chunk),
      onDone: () => {
        const responseText = useLlmResponseStore.getState().responseText;
        useLlmResponseStore.getState().finishStream();
        view.dispatch({ effects: clearFiringAnnotation.of(annotation.char_start) });

        if (fireType === "replacing") {
          view.dispatch({
            changes: { from: annotation.char_start, to: annotation.char_end, insert: responseText },
          });
        }

        useModalLockStore.getState().setLlmLocked(false);
        window.dispatchEvent(new CustomEvent("lit:fire-complete", { detail: { annotation } }));
      },
      onError: (error) => {
        view.dispatch({ effects: clearFiringAnnotation.of(annotation.char_start) });
        useLlmResponseStore.getState().setError(error.message);
        useModalLockStore.getState().setLlmLocked(false);
        window.dispatchEvent(new CustomEvent("lit:fire-complete", { detail: { annotation, error: error.message } }));
      },
    },
  );
}
