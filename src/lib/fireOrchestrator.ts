import type { EditorView } from "@codemirror/view";
import type { Annotation, AnnotationType } from "./ipc";
import { resolveAnnotationScopeWithMode } from "./ipc";
import { startLlmStream, cancelLlmStream } from "./llmClient";
import { canFire } from "./fireClassification";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useSecretStoreStore } from "../stores/secretStore";
import { setFiringAnnotation, clearFiringAnnotation } from "../editor/livePreview/annotationWidgets";
import { buildThreadDsl } from "./companionInsert";

export interface FireAnnotationArgs {
  view: EditorView;
  annotation: Annotation;
}

const PROMPT_FIELD_MAP: Partial<Record<AnnotationType, keyof PreferencesState>> = {
  llm: "llmPromptLlm",
  translation: "llmPromptTr",
  question: "llmPromptQ",
};

export function getTypePrompt(annotationType: AnnotationType): string {
  const field = PROMPT_FIELD_MAP[annotationType];
  if (!field) return "";
  return (usePreferencesStore.getState()[field] as string) ?? "";
}

export function stripAnnotations(text: string): string {
  return text
    .replace(/<!---[\s\S]*?--->/g, "")
    .replace(/%%![\s\S]*?%%/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
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

  let cleanedUp = false;
  let cancelHandler: (() => void) | null = null;
  const doCleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (cancelHandler) window.removeEventListener("lit:cancel-fire", cancelHandler);
    try { view.dispatch({ effects: clearFiringAnnotation.of(annotation.char_start) }); } catch { /* view destroyed */ }
    useModalLockStore.getState().setLlmLocked(false);
    window.dispatchEvent(new CustomEvent("lit:fire-complete", { detail: { annotation } }));
  };

  const prefs = usePreferencesStore.getState();
  const doc = view.state.doc.toString();
  const lang = prefs.annotationDefaultLang;

  if (!canFire(annotation.annotation_type)) {
    doCleanup();
    return;
  }

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
      scopeText = stripAnnotations(doc.slice(range.start, range.end));
    }
  } catch (err) {
    console.warn("Scope resolution failed, proceeding with empty scope:", err);
  }

  const system = getTypePrompt(annotation.annotation_type);
  const text = buildFirePrompt(scopeText, annotation.body);

  try {
    await useSecretStoreStore.getState().ensureUnlocked();
  } catch {
    doCleanup();
    return;
  }

  let responseText = "";

  cancelHandler = () => {
    cancelLlmStream().catch(console.error);
    doCleanup();
  };
  window.addEventListener("lit:cancel-fire", cancelHandler);

  try {
    await startLlmStream(
      { model: prefs.llmModel, text, system: system || undefined },
      {
        onChunk: (chunk) => {
          responseText += chunk;
        },
        onDone: () => {
          try {
            const threadDsl = buildThreadDsl(annotation, responseText);
            view.dispatch({
              changes: {
                from: annotation.char_start,
                to: annotation.char_end,
                insert: threadDsl,
              },
            });
          } catch { /* view destroyed */ }

          doCleanup();
        },
        onError: (error) => {
          useStatusMessageStore.getState().show(error.message, "error");
          doCleanup();
        },
      },
    );
  } catch (err) {
    useStatusMessageStore.getState().show(
      err instanceof Error ? err.message : "LLM stream failed",
      "error",
    );
    doCleanup();
  }
}
