import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke, mockListen, resetListenMock } from "../test/tauri-mock";
import { useModalLockStore } from "../stores/modalLock";
import { useLlmResponseStore, STOP_INDICATOR } from "../stores/llmResponse";
import { handleQuestionSubmit } from "./llmOrchestrator";
import type { LlmStreamCallbacks } from "./llmClient";

vi.mock("./llmClient", () => ({
  startLlmStream: vi.fn(() => Promise.resolve()),
  cancelLlmStream: vi.fn(() => Promise.resolve()),
}));

describe("llmOrchestrator", () => {
  beforeEach(async () => {
    resetListenMock();
    mockListen();
    mockInvoke(() => null);
    useModalLockStore.setState({ openCount: 0, locked: false, llmLocked: false });
    useLlmResponseStore.getState().reset();
    const { startLlmStream } = await import("./llmClient");
    (startLlmStream as ReturnType<typeof vi.fn>).mockClear();
    (startLlmStream as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());
  });

  it("rejects when already streaming", async () => {
    useLlmResponseStore.setState({ status: "streaming" });
    const { startLlmStream } = await import("./llmClient");

    await handleQuestionSubmit({
      question: "test",
      model: "claude-sonnet-4-6",
      text: "doc content",
    });

    expect(startLlmStream).not.toHaveBeenCalled();
  });

  it("sets llmLocked true on start", async () => {
    const { startLlmStream } = await import("./llmClient");
    (startLlmStream as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());

    await handleQuestionSubmit({
      question: "test",
      model: "claude-sonnet-4-6",
      text: "doc content",
    });

    expect(useModalLockStore.getState().llmLocked).toBe(true);
  });

  it("onDone clears llmLocked", async () => {
    const { startLlmStream } = await import("./llmClient");
    let capturedCallbacks: LlmStreamCallbacks | null = null;
    (startLlmStream as ReturnType<typeof vi.fn>).mockImplementation(
      (_args: unknown, cbs: LlmStreamCallbacks) => {
        capturedCallbacks = cbs;
        return Promise.resolve();
      },
    );

    await handleQuestionSubmit({
      question: "test",
      model: "claude-sonnet-4-6",
      text: "doc content",
    });

    expect(useModalLockStore.getState().llmLocked).toBe(true);
    capturedCallbacks!.onDone();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
  });

  it("onError clears llmLocked", async () => {
    const { startLlmStream } = await import("./llmClient");
    let capturedCallbacks: LlmStreamCallbacks | null = null;
    (startLlmStream as ReturnType<typeof vi.fn>).mockImplementation(
      (_args: unknown, cbs: LlmStreamCallbacks) => {
        capturedCallbacks = cbs;
        return Promise.resolve();
      },
    );

    await handleQuestionSubmit({
      question: "test",
      model: "claude-sonnet-4-6",
      text: "doc content",
    });

    capturedCallbacks!.onError({ message: "fail", retryable: false });
    expect(useModalLockStore.getState().llmLocked).toBe(false);
  });

  it("cancel clears llmLocked", async () => {
    const { startLlmStream, cancelLlmStream } = await import("./llmClient");
    (startLlmStream as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());

    await handleQuestionSubmit({
      question: "test",
      model: "claude-sonnet-4-6",
      text: "doc content",
    });

    expect(useModalLockStore.getState().llmLocked).toBe(true);

    const { cancelStream } = await import("./llmOrchestrator");
    await cancelStream();

    expect(cancelLlmStream).toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
  });

  it("cancel transitions store status to done", async () => {
    const { startLlmStream } = await import("./llmClient");
    (startLlmStream as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());

    await handleQuestionSubmit({
      question: "test",
      model: "claude-sonnet-4-6",
      text: "doc content",
    });

    useLlmResponseStore.getState().appendChunk("partial");
    expect(useLlmResponseStore.getState().status).toBe("streaming");

    const { cancelStream } = await import("./llmOrchestrator");
    await cancelStream();

    expect(useLlmResponseStore.getState().status).toBe("done");
  });

  it("cancel preserves partial response text with stopped indicator", async () => {
    const { startLlmStream } = await import("./llmClient");
    (startLlmStream as ReturnType<typeof vi.fn>).mockImplementation(() => Promise.resolve());

    await handleQuestionSubmit({
      question: "test",
      model: "claude-sonnet-4-6",
      text: "doc content",
    });

    useLlmResponseStore.getState().appendChunk("partial response");

    const { cancelStream } = await import("./llmOrchestrator");
    await cancelStream();

    expect(useLlmResponseStore.getState().responseText).toBe("partial response" + STOP_INDICATOR);
  });
});
