import { create } from "zustand";
import type { LlmPrefix } from "../lib/promptFormatter";

export interface LlmResponseState {
  status: "idle" | "streaming" | "done" | "error";
  prefix: LlmPrefix;
  question: string;
  responseText: string;
  errorMessage: string;
  selectionFrom: number;
  selectionTo: number;
  startStream: (opts: {
    prefix: LlmPrefix;
    question: string;
    selectionFrom?: number;
    selectionTo?: number;
  }) => void;
  appendChunk: (text: string) => void;
  finishStream: () => void;
  setError: (msg: string) => void;
  reset: () => void;
}

export const useLlmResponseStore = create<LlmResponseState>((set) => ({
  status: "idle",
  prefix: "ask",
  question: "",
  responseText: "",
  errorMessage: "",
  selectionFrom: 0,
  selectionTo: 0,

  startStream: (opts) =>
    set({
      status: "streaming",
      prefix: opts.prefix,
      question: opts.question,
      responseText: "",
      errorMessage: "",
      selectionFrom: opts.selectionFrom ?? 0,
      selectionTo: opts.selectionTo ?? 0,
    }),

  appendChunk: (text) =>
    set((s) => ({ responseText: s.responseText + text })),

  finishStream: () => set({ status: "done" }),

  setError: (msg) => set({ status: "error", errorMessage: msg }),

  reset: () =>
    set({
      status: "idle",
      prefix: "ask",
      question: "",
      responseText: "",
      errorMessage: "",
      selectionFrom: 0,
      selectionTo: 0,
    }),
}));
