import { create } from "zustand";
import type { Annotation } from "../lib/ipc";

export interface LlmResponseState {
  status: "idle" | "streaming" | "done" | "error";
  question: string;
  responseText: string;
  errorMessage: string;
  selectionFrom: number;
  selectionTo: number;
  fireSourceAnnotation: Annotation | null;
  startStream: (opts: {
    question: string;
    selectionFrom?: number;
    selectionTo?: number;
    fireSourceAnnotation?: Annotation | null;
  }) => void;
  appendChunk: (text: string) => void;
  finishStream: () => void;
  setError: (msg: string) => void;
  reset: () => void;
}

export const useLlmResponseStore = create<LlmResponseState>((set) => ({
  status: "idle",
  question: "",
  responseText: "",
  errorMessage: "",
  selectionFrom: 0,
  selectionTo: 0,
  fireSourceAnnotation: null,

  startStream: (opts) =>
    set({
      status: "streaming",
      question: opts.question,
      responseText: "",
      errorMessage: "",
      selectionFrom: opts.selectionFrom ?? 0,
      selectionTo: opts.selectionTo ?? 0,
      fireSourceAnnotation: opts.fireSourceAnnotation ?? null,
    }),

  appendChunk: (text) =>
    set((s) => ({ responseText: s.responseText + text })),

  finishStream: () => set({ status: "done" }),

  setError: (msg) => set({ status: "error", errorMessage: msg }),

  reset: () =>
    set({
      status: "idle",
      question: "",
      responseText: "",
      errorMessage: "",
      selectionFrom: 0,
      selectionTo: 0,
      fireSourceAnnotation: null,
    }),
}));
