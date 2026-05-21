import { describe, it, expect, beforeEach } from "vitest";
import { useLlmResponseStore } from "./llmResponse";

describe("llmResponse store", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  it("initial state", () => {
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.responseText).toBe("");
    expect(s.question).toBe("");
  });

  it("startStream sets streaming state", () => {
    useLlmResponseStore.getState().startStream({ question: "summarize" });
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("streaming");
    expect(s.question).toBe("summarize");
    expect(s.responseText).toBe("");
  });

  it("appendChunk accumulates text", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("hello ");
    useLlmResponseStore.getState().appendChunk("world");
    expect(useLlmResponseStore.getState().responseText).toBe("hello world");
  });

  it("finishStream sets done", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().finishStream();
    expect(useLlmResponseStore.getState().status).toBe("done");
  });

  it("setError sets error state", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().setError("something broke");
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("error");
    expect(s.errorMessage).toBe("something broke");
  });

  it("reset returns to initial state", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("text");
    useLlmResponseStore.getState().reset();
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.responseText).toBe("");
    expect(s.question).toBe("");
  });

  it("fireSourceAnnotation defaults to null", () => {
    expect(useLlmResponseStore.getState().fireSourceAnnotation).toBeNull();
  });

  it("startStream sets fireSourceAnnotation when provided", () => {
    const ann = {
      form: "compact" as const,
      annotation_type: "question" as const,
      certainty: "neutral" as const,
      scope: { kind: "sentence" as const, value: 1 },
      body: "why?",
      date: null,
      is_structured: true,
      char_start: 0,
      char_end: 10,
      original: "%%!q | why? %%",
    };
    useLlmResponseStore.getState().startStream({
      question: "why?",
      fireSourceAnnotation: ann,
    });
    expect(useLlmResponseStore.getState().fireSourceAnnotation).toBe(ann);
  });

  it("startStream defaults fireSourceAnnotation to null when not provided", () => {
    useLlmResponseStore.getState().startStream({
      question: "q",
    });
    expect(useLlmResponseStore.getState().fireSourceAnnotation).toBeNull();
  });

  it("reset clears fireSourceAnnotation", () => {
    const ann = {
      form: "compact" as const,
      annotation_type: "question" as const,
      certainty: "neutral" as const,
      scope: { kind: "sentence" as const, value: 1 },
      body: "why?",
      date: null,
      is_structured: true,
      char_start: 0,
      char_end: 10,
      original: "%%!q | why? %%",
    };
    useLlmResponseStore.getState().startStream({
      question: "q",
      fireSourceAnnotation: ann,
    });
    useLlmResponseStore.getState().reset();
    expect(useLlmResponseStore.getState().fireSourceAnnotation).toBeNull();
  });
});
