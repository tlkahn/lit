import type { EditorView } from "@codemirror/view";
import type { Annotation } from "./ipc";
import { usePreferencesStore } from "../stores/preferences";
import {
  clearFiringAnnotation,
  setThreadTurnEffect,
} from "../editor/livePreview/annotationWidgets";
import { annotationToFields, generateDsl } from "./annotationDsl";
import { parseThreadBody, turnsToMessages, appendTurn } from "./threadBody";
import { getTypePrompt } from "./fireOrchestrator";
import { withLlmStream } from "./withLlmStream";

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
 * Mirrors `fireAnnotation`'s lifecycle (LLM lock, firing effect, passphrase
 * unlock, streaming, cleanup), but instead of a one-shot prompt it
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

  // Must run BEFORE the harness so an empty question never locks or shows the
  // spinner.
  if (!question.trim()) return;

  return withLlmStream(view, annotation, {
    buildArgs: async () => {
      const prefs = usePreferencesStore.getState();
      const turns = parseThreadBody(annotation.body ?? "");
      const messages = [...turnsToMessages(turns), { role: "user", content: question }];
      const system = resolveThreadSystemPrompt(annotation);
      const customDef = prefs.llmProvider.providerId.startsWith("custom-")
        ? prefs.llmCustomProviders.find((p) => p.id === prefs.llmProvider.providerId)
        : undefined;
      return {
        provider: prefs.llmProvider.providerId,
        model: prefs.llmProvider.model,
        text: "",
        system: system || undefined,
        messages,
        baseUrl: prefs.llmProvider.baseUrl ?? customDef?.baseUrl,
        contextWindow: customDef?.contextWindow,
      };
    },
    onDone: ({ responseText, markFiringCleared, liveRange }) => {
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
        const changes = view.state.changes({
          from: liveRange.from,
          to: liveRange.to,
          insert: dsl,
        });
        const mapped = changes.mapPos(liveRange.from, 1);
        view.dispatch({
          changes,
          effects: [
            clearFiringAnnotation.of(mapped),
            setThreadTurnEffect.of({ pos: mapped, turn: newTurnIndex }),
          ],
        });
        markFiringCleared();
      } catch {
        /* view destroyed */
      }
    },
  });
}
