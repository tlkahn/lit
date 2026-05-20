import { listen } from "@tauri-apps/api/event";
import { llmPromptStreaming, llmCancel, type LlmPromptStreamingArgs } from "./ipc";

export interface LlmStreamCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: { message: string; retryable: boolean }) => void;
  onUsage?: (usage: { input: number; output: number }) => void;
  onTruncated?: (info: unknown) => void;
}

export async function startLlmStream(
  args: LlmPromptStreamingArgs,
  callbacks: LlmStreamCallbacks,
): Promise<void> {
  const unlisteners: Array<() => void> = [];

  function cleanup() {
    for (const fn of unlisteners) fn();
    unlisteners.length = 0;
  }

  const results = await Promise.all([
    listen<string>("llm://chunk", (event) => {
      callbacks.onChunk(event.payload);
    }),
    listen("llm://done", () => {
      callbacks.onDone();
      cleanup();
    }),
    listen<{ message: string; retryable: boolean }>("llm://error", (event) => {
      callbacks.onError(event.payload);
      cleanup();
    }),
    listen<{ input: number; output: number }>("llm://usage", (event) => {
      callbacks.onUsage?.(event.payload);
    }),
    listen("llm://truncated", (event) => {
      callbacks.onTruncated?.(event.payload);
    }),
  ]);
  unlisteners.push(...results);

  try {
    await llmPromptStreaming(args);
  } catch (err) {
    cleanup();
    throw err;
  }
}

export async function cancelLlmStream(): Promise<void> {
  await llmCancel();
}
