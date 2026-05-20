import { startLlmStream, cancelLlmStream } from "./llmClient";
import { useModalLockStore } from "../stores/modalLock";
import { useLlmResponseStore } from "../stores/llmResponse";
import type { LlmPrefix } from "./promptFormatter";

export interface QuestionSubmitArgs {
  prefix: LlmPrefix;
  question: string;
  model: string;
  text: string;
  system?: string;
  selectionFrom?: number;
  selectionTo?: number;
}

export async function handleQuestionSubmit(args: QuestionSubmitArgs): Promise<void> {
  if (useLlmResponseStore.getState().status === "streaming") return;

  useModalLockStore.getState().setLlmLocked(true);
  useLlmResponseStore.getState().startStream({
    prefix: args.prefix,
    question: args.question,
    selectionFrom: args.selectionFrom,
    selectionTo: args.selectionTo,
  });

  await startLlmStream(
    { model: args.model, text: args.text, system: args.system },
    {
      onChunk: (text) => useLlmResponseStore.getState().appendChunk(text),
      onDone: () => {
        useLlmResponseStore.getState().finishStream();
        useModalLockStore.getState().setLlmLocked(false);
      },
      onError: (error) => {
        useLlmResponseStore.getState().setError(error.message);
        useModalLockStore.getState().setLlmLocked(false);
      },
    },
  );
}

export async function cancelStream(): Promise<void> {
  useModalLockStore.getState().setLlmLocked(false);
  await cancelLlmStream();
}
