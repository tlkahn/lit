import type { EditorView } from "@codemirror/view";
import type { Annotation, AnnotationType } from "./ipc";
import { resolveAnnotationScopeWithMode, annotationFindUuid } from "./ipc";
import { startLlmStream } from "./llmClient";
import { classifyFireType } from "./fireClassification";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore, type PreferencesState } from "../stores/preferences";
import { useLlmResponseStore } from "../stores/llmResponse";
import { useConversationStore } from "../stores/conversation";
import { useWorkspaceStore } from "../stores/workspace";
import { useBottomPanelStore } from "../stores/bottomPanel";
import { useSecretStoreStore } from "../stores/secretStore";
import { setFiringAnnotation, clearFiringAnnotation, annotationThreadKeysField, setAnnotationThreadKeys } from "../editor/livePreview/annotationWidgets";
import { insertCompanionAnnotation } from "./companionInsert";

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

export async function fireAnnotation(args: FireAnnotationArgs): Promise<(() => void) | void> {
  const { view, annotation } = args;

  if (useModalLockStore.getState().llmLocked) {
    throw new Error("LLM is already streaming");
  }

  useModalLockStore.getState().setLlmLocked(true);
  view.dispatch({ effects: setFiringAnnotation.of(annotation.char_start) });
  window.dispatchEvent(new CustomEvent("lit:fire-started", { detail: { annotation } }));

  let cleanedUp = false;
  const doCleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try { view.dispatch({ effects: clearFiringAnnotation.of(annotation.char_start) }); } catch { /* view destroyed */ }
    useModalLockStore.getState().setLlmLocked(false);
    window.dispatchEvent(new CustomEvent("lit:fire-complete", { detail: { annotation } }));
  };

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
      scopeText = stripAnnotations(doc.slice(range.start, range.end));
    }
  } catch (err) {
    console.warn("Scope resolution failed, proceeding with empty scope:", err);
  }

  const system = getTypePrompt(annotation.annotation_type);
  const text = buildFirePrompt(scopeText, annotation.body);
  const fireType = classifyFireType(annotation.annotation_type);
  if (!fireType) {
    doCleanup();
    return;
  }

  if (fireType === "persisting") {
    const nodeId = useWorkspaceStore.getState().currentPagePath;
    if (!nodeId) {
      useLlmResponseStore.getState().setError("No active file. Open a file and try again.");
      useBottomPanelStore.getState().handleTabClick("llm-response");
      doCleanup();
      return;
    }

    let uuid: string | null;
    try {
      uuid = await annotationFindUuid(
        nodeId, annotation.annotation_type, annotation.body, annotation.char_start,
      );
    } catch (err) {
      console.warn("annotationFindUuid failed:", err);
      useLlmResponseStore.getState().setError("Failed to look up annotation. Save the file and try again.");
      useBottomPanelStore.getState().handleTabClick("llm-response");
      doCleanup();
      return;
    }
    if (!uuid) {
      useLlmResponseStore.getState().setError("Annotation not found in index. Save the file and try again.");
      useBottomPanelStore.getState().handleTabClick("llm-response");
      doCleanup();
      return;
    }

    const currentKeys = view.state.field(annotationThreadKeysField, false) ?? new Set<string>();
    const newKeys = new Set(currentKeys);
    newKeys.add(uuid);
    view.dispatch({ effects: setAnnotationThreadKeys.of(newKeys) });

    useBottomPanelStore.getState().handleTabClick("llm-response");

    const title = annotation.body
      ? `${annotation.annotation_type}: ${annotation.body}`
      : annotation.annotation_type;

    const cleanup = () => {
      unsubscribe();
      doCleanup();
    };

    const unsubscribe = useLlmResponseStore.subscribe((state, prev) => {
      if (cleanedUp) return;
      if (state.status !== prev.status && (state.status === "done" || state.status === "error")) {
        cleanup();
      }
    });

    useConversationStore.getState().sendAnnotationFire({
      nodeId,
      annotationUuid: uuid,
      annotation,
      content: annotation.body ?? text,
      textOverride: text,
      model: prefs.llmModel,
      system: system || undefined,
      title,
    })
      .catch((err) => console.error("sendAnnotationFire failed:", err))
      .finally(() => {
        if (useLlmResponseStore.getState().status !== "streaming") {
          cleanup();
        }
      });

    const dispose = () => {
      cleanup();
    };

    return dispose;
  }

  try {
    await useSecretStoreStore.getState().ensureUnlocked();
  } catch {
    doCleanup();
    return;
  }

  useLlmResponseStore.getState().startStream({
    question: annotation.body ?? "",
    fireSourceAnnotation: annotation,
  });

  await startLlmStream(
    { model: prefs.llmModel, text, system: system || undefined },
    {
      onChunk: (chunk) => useLlmResponseStore.getState().appendChunk(chunk),
      onDone: () => {
        const responseText = useLlmResponseStore.getState().responseText;
        useLlmResponseStore.getState().finishStream();

        if (fireType === "replacing") {
          try {
            insertCompanionAnnotation(view, annotation, responseText);
          } catch { /* view destroyed */ }
        }

        doCleanup();
      },
      onError: (error) => {
        useLlmResponseStore.getState().setError(error.message);
        doCleanup();
      },
    },
  );
}
