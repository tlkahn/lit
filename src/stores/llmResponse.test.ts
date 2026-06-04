import { describe, it, expect, beforeEach } from "vitest";
import { useLlmResponseStore, STOP_INDICATOR } from "./llmResponse";

describe("llmResponse store", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  it("initial state", () => {
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("idle");
    expect(s.responseText).toBe("");
  });

  it("startStream sets streaming state", () => {
    useLlmResponseStore.getState().startStream({ question: "summarize" });
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("streaming");
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
  });

  it("stopStream sets status to done and preserves accumulated text", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("partial response");
    useLlmResponseStore.getState().stopStream();
    const s = useLlmResponseStore.getState();
    expect(s.status).toBe("done");
    expect(s.responseText).toContain("partial response");
  });

  it("stopStream appends stopped indicator to responseText", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("partial");
    useLlmResponseStore.getState().stopStream();
    expect(useLlmResponseStore.getState().responseText).toBe("partial" + STOP_INDICATOR);
  });

  it("stopStream works when responseText is empty", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().stopStream();
    expect(useLlmResponseStore.getState().responseText).toBe(STOP_INDICATOR);
    expect(useLlmResponseStore.getState().status).toBe("done");
  });
});
