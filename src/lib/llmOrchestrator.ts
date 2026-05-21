import { startLlmStream, cancelLlmStream } from "./llmClient";
import { useModalLockStore } from "../stores/modalLock";
import { useLlmResponseStore } from "../stores/llmResponse";

export interface QuestionSubmitArgs {
  question: string;
  model: string;
  text: string;
  system?: string;
}

export async function handleQuestionSubmit(args: QuestionSubmitArgs): Promise<void> {
  if (useLlmResponseStore.getState().status === "streaming") return;

  useModalLockStore.getState().setLlmLocked(true);
  useLlmResponseStore.getState().startStream({
    question: args.question,
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
  useLlmResponseStore.getState().stopStream();
  useModalLockStore.getState().setLlmLocked(false);
  await cancelLlmStream();
}
