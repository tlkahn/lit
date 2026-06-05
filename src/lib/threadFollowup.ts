import type { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { resolveAnnotationScopeWithMode } from "./ipc";
import { startLlmStream, cancelLlmStream } from "./llmClient";
import { useModalLockStore } from "../stores/modalLock";
import { usePreferencesStore } from "../stores/preferences";
import { useStatusMessageStore } from "../stores/statusMessage";
import { useSecretStoreStore } from "../stores/secretStore";
import {
  setFiringAnnotation,
  clearFiringAnnotation,
  setThreadTurnEffect,
} from "../editor/livePreview/annotationWidgets";
import { annotationToFields, generateDsl } from "./annotationDsl";
import { parseThreadBody, turnsToMessages, appendTurn } from "./threadBody";
import { getTypePrompt } from "./fireOrchestrator";

export interface ThreadFollowupArgs {
  view: EditorView;
  annotation: Annotation;
  question: string;
}

/**
 * Resolve the system prompt for a thread follow-up. A fired thread carries
 * `annotation_type: "thread"`, for which `getTypePrompt` returns "" (no entry in
 * the prompt-field map), so fall back to the conversational `llmPromptQ`. The
 * original source type is not recoverable from the thread annotation.
 */
export function resolveThreadSystemPrompt(annotation: Annotation): string {
  return getTypePrompt(annotation.annotation_type) || usePreferencesStore.getState().llmPromptQ;
}

/**
 * Ask a follow-up question against an existing thread annotation.
 *
 * Mirrors `fireAnnotation`'s lifecycle (LLM lock, firing effect, scope resolve,
 * passphrase unlock, streaming, cleanup), but instead of a one-shot prompt it
 * replays the thread's conversation history as the `messages[]` array with the
 * follow-up appended as the final user message. On completion the new turn is
 * appended to the body, the thread DSL is regenerated in place, and the current
 * turn is advanced to the new last index — all in a single transaction.
 *
 * The follow-up question is sent ONLY via `messages`; the backend ignores
 * `prompt.text` whenever `messages` is non-empty (build_from_conversation), so
 * `text` is intentionally empty.
 */
export async function threadFollowup(args: ThreadFollowupArgs): Promise<void> {
  const { view, annotation, question } = args;

  if (!question.trim()) return;

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
    try {
      view.dispatch({ effects: clearFiringAnnotation.of(annotation.char_start) });
    } catch {
      /* view destroyed */
    }
    useModalLockStore.getState().setLlmLocked(false);
    window.dispatchEvent(new CustomEvent("lit:fire-complete", { detail: { annotation } }));
  };

  const prefs = usePreferencesStore.getState();
  const doc = view.state.doc.toString();
  const lang = prefs.annotationDefaultLang;

  // Resolve scope best-effort. The conversation history already carries the
  // context the thread was fired on, so scope is not re-sent — but resolving it
  // keeps parity with the fire flow and surfaces resolution errors the same way.
  try {
    await resolveAnnotationScopeWithMode(doc, annotation.char_start, annotation.scope, lang, "bidirectional");
  } catch (err) {
    console.warn("Scope resolution failed during follow-up:", err);
  }

  const turns = parseThreadBody(annotation.body ?? "");
  const messages = [...turnsToMessages(turns), { role: "user", content: question }];
  const system = resolveThreadSystemPrompt(annotation);

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
      {
        model: prefs.llmModel,
        text: "",
        system: system || undefined,
        messages,
      },
      {
        onChunk: (chunk) => {
          responseText += chunk;
        },
        onDone: () => {
          try {
            const newBody = appendTurn(annotation.body ?? "", question, responseText);
            const scope = annotationToFields(annotation).scope;
            const dsl = generateDsl({
              id: annotation.uuid ?? crypto.randomUUID(),
              type: "thread",
              certainty: annotation.certainty,
              scope,
              body: newBody,
              date: annotation.date,
            });
            const newTurnIndex = parseThreadBody(newBody).length - 1;
            view.dispatch({
              changes: {
                from: annotation.char_start,
                to: annotation.char_end,
                insert: dsl,
              },
              effects: setThreadTurnEffect.of({ pos: annotation.char_start, turn: newTurnIndex }),
            });
          } catch {
            /* view destroyed */
          }
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
