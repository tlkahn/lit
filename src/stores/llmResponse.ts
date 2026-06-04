import { create } from "zustand";

export const STOP_INDICATOR = "\n\n**[Stopped]**";

export interface LlmResponseState {
  status: "idle" | "streaming" | "done" | "error";
  responseText: string;
  errorMessage: string;
  startStream: (opts: {
    question: string;
  }) => void;
  appendChunk: (text: string) => void;
  finishStream: () => void;
  stopStream: () => void;
  setError: (msg: string) => void;
  reset: () => void;
}

export const useLlmResponseStore = create<LlmResponseState>((set) => ({
  status: "idle",
  responseText: "",
  errorMessage: "",

  startStream: () =>
    set({
      status: "streaming",
      responseText: "",
      errorMessage: "",
    }),

  appendChunk: (text) =>
    set((s) => ({ responseText: s.responseText + text })),

  finishStream: () => set({ status: "done" }),

  stopStream: () =>
    set((s) => ({ status: "done", responseText: s.responseText + STOP_INDICATOR })),

  setError: (msg) => set({ status: "error", errorMessage: msg }),

  reset: () =>
    set({
      status: "idle",
      responseText: "",
      errorMessage: "",
    }),
}));
