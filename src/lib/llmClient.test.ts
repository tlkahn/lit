import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockInvoke, mockListen, emitMockEvent, resetListenMock } from "../test/tauri-mock";
import { startLlmStream, cancelLlmStream } from "./llmClient";

describe("llmClient", () => {
  beforeEach(() => {
    resetListenMock();
    mockListen();
    mockInvoke((cmd) => {
      switch (cmd) {
        case "llm_prompt_streaming":
          return null;
        case "llm_cancel":
          return null;
        default:
          throw new Error(`Unknown command: ${cmd}`);
      }
    });
  });

  it("registers listeners for all 5 event channels and invokes llm_prompt_streaming", async () => {
    const callbacks = {
      onChunk: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onUsage: vi.fn(),
      onTruncated: vi.fn(),
    };

    await startLlmStream({ model: "claude-sonnet-4-6", text: "hello" }, callbacks);

    const { listen } = await import("@tauri-apps/api/event");
    expect(listen).toHaveBeenCalledWith("llm://chunk", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("llm://done", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("llm://error", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("llm://usage", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("llm://truncated", expect.any(Function));

    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_prompt_streaming", expect.any(Object));
  });

  it("chunk events call onChunk", async () => {
    const onChunk = vi.fn();
    await startLlmStream(
      { model: "claude-sonnet-4-6", text: "hello" },
      { onChunk, onDone: vi.fn(), onError: vi.fn() },
    );

    emitMockEvent("llm://chunk", "hello");
    expect(onChunk).toHaveBeenCalledWith("hello");
  });

  it("done event calls onDone and cleans up listeners", async () => {
    const onDone = vi.fn();
    const onChunk = vi.fn();
    await startLlmStream(
      { model: "claude-sonnet-4-6", text: "hello" },
      { onChunk, onDone, onError: vi.fn() },
    );

    emitMockEvent("llm://done", null);
    expect(onDone).toHaveBeenCalled();

    onChunk.mockClear();
    emitMockEvent("llm://chunk", "after-done");
    expect(onChunk).not.toHaveBeenCalled();
  });

  it("error event calls onError", async () => {
    const onError = vi.fn();
    await startLlmStream(
      { model: "claude-sonnet-4-6", text: "hello" },
      { onChunk: vi.fn(), onDone: vi.fn(), onError },
    );

    emitMockEvent("llm://error", { message: "fail", retryable: false });
    expect(onError).toHaveBeenCalledWith({ message: "fail", retryable: false });
  });

  it("usage event calls onUsage", async () => {
    const onUsage = vi.fn();
    await startLlmStream(
      { model: "claude-sonnet-4-6", text: "hello" },
      { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onUsage },
    );

    emitMockEvent("llm://usage", { input: 100, output: 50 });
    expect(onUsage).toHaveBeenCalledWith({ input: 100, output: 50 });
  });

  it("truncated event calls onTruncated", async () => {
    const onTruncated = vi.fn();
    await startLlmStream(
      { model: "claude-sonnet-4-6", text: "hello" },
      { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn(), onTruncated },
    );

    emitMockEvent("llm://truncated", { dropped: 5 });
    expect(onTruncated).toHaveBeenCalledWith({ dropped: 5 });
  });

  it("cleans up all listeners if llmPromptStreaming throws", async () => {
    mockInvoke((cmd) => {
      if (cmd === "llm_prompt_streaming") throw new Error("backend unavailable");
      return null;
    });
    const callbacks = { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
    await expect(
      startLlmStream({ model: "claude-sonnet-4-6", text: "hello" }, callbacks),
    ).rejects.toThrow("backend unavailable");
    emitMockEvent("llm://chunk", "stale");
    emitMockEvent("llm://done", null);
    expect(callbacks.onChunk).not.toHaveBeenCalled();
    expect(callbacks.onDone).not.toHaveBeenCalled();
  });

  it("registers all listeners before calling llmPromptStreaming", async () => {
    const callOrder: string[] = [];
    resetListenMock();
    const { listen } = await import("@tauri-apps/api/event");
    (listen as ReturnType<typeof vi.fn>).mockImplementation((event: string, callback: unknown) => {
      callOrder.push(`listen:${event}`);
      void callback;
      return Promise.resolve(() => {});
    });
    mockInvoke((cmd) => {
      if (cmd === "llm_prompt_streaming") callOrder.push("invoke");
      return null;
    });
    await startLlmStream(
      { model: "claude-sonnet-4-6", text: "hello" },
      { onChunk: vi.fn(), onDone: vi.fn(), onError: vi.fn() },
    );
    const invokeIdx = callOrder.indexOf("invoke");
    const listenCalls = callOrder.filter((e) => e.startsWith("listen:"));
    expect(listenCalls).toHaveLength(5);
    expect(invokeIdx).toBe(5);
  });

  it("cancelLlmStream calls llmCancel IPC", async () => {
    await cancelLlmStream();
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).toHaveBeenCalledWith("llm_cancel");
  });
});
