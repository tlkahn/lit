import { describe, it, expect, beforeEach } from "vitest";
import { useLlmResponseStore } from "./llmResponse";

describe("llmResponse store", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  it("initial state", () => {
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.prefix).toBe("ask");
    expect(s.responseText).toBe("");
    expect(s.question).toBe("");
  });

  it("startStream sets streaming state", () => {
    useLlmResponseStore.getState().startStream({ prefix: "insert", question: "summarize" });
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("streaming");
    expect(s.prefix).toBe("insert");
    expect(s.question).toBe("summarize");
    expect(s.responseText).toBe("");
  });

  it("appendChunk accumulates text", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("hello ");
    useLlmResponseStore.getState().appendChunk("world");
    expect(useLlmResponseStore.getState().responseText).toBe("hello world");
  });

  it("finishStream sets done", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().finishStream();
    expect(useLlmResponseStore.getState().status).toBe("done");
  });

  it("setError sets error state", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().setError("something broke");
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("error");
    expect(s.errorMessage).toBe("something broke");
  });

  it("reset returns to initial state", () => {
    useLlmResponseStore.getState().startStream({ prefix: "insert", question: "q" });
    useLlmResponseStore.getState().appendChunk("text");
    useLlmResponseStore.getState().reset();
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.prefix).toBe("ask");
    expect(s.responseText).toBe("");
    expect(s.question).toBe("");
  });

  it("startStream with selection range for /rewrite", () => {
    useLlmResponseStore.getState().startStream({
      prefix: "rewrite",
      question: "improve",
      selectionFrom: 10,
      selectionTo: 20,
    });
    const s = useLlmResponseStore.getState();
    expect(s.selectionFrom).toBe(10);
    expect(s.selectionTo).toBe(20);
  });
});
