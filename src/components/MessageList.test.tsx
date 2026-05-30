import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { MessageList } from "./MessageList";
import type { MessageRow } from "../lib/ipc";
import { useLlmResponseStore } from "../stores/llmResponse";
import { useEditorSelectionStore } from "../stores/editorSelection";

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 1,
    conversation_id: "conv-1",
    role: "user",
    content: "Hello",
    seq: 1,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("MessageList", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  // Cycle 6: Basic rendering
  it("renders empty state with data-testid message-list when no messages", () => {
    const { getByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(getByTestId("message-list")).toBeTruthy();
  });

  it("renders a MessageBubble for each message", () => {
    const messages = [
      makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" }),
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
      makeMessage({ id: 3, seq: 3, role: "user", content: "Q2" }),
    ];
    const { getAllByTestId } = render(
      <MessageList messages={messages} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const userBubbles = getAllByTestId("message-bubble-user");
    const assistantBubbles = getAllByTestId("message-bubble-assistant");
    expect(userBubbles).toHaveLength(2);
    expect(assistantBubbles).toHaveLength(1);
  });

  it("renders messages in sequential order", () => {
    const messages = [
      makeMessage({ id: 1, seq: 1, role: "user", content: "First" }),
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "Second" }),
      makeMessage({ id: 3, seq: 3, role: "user", content: "Third" }),
    ];
    const { getByTestId } = render(
      <MessageList messages={messages} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const list = getByTestId("message-list");
    const bubbles = list.querySelectorAll("[data-testid^='message-bubble-']");
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]!.textContent).toContain("First");
    expect(bubbles[1]!.textContent).toContain("Second");
    expect(bubbles[2]!.textContent).toContain("Third");
  });

  it("passes isLast=true only to the final assistant message", () => {
    const messages = [
      makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" }),
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
      makeMessage({ id: 3, seq: 3, role: "user", content: "Q2" }),
      makeMessage({ id: 4, seq: 4, role: "assistant", content: "A2" }),
    ];
    const onRetry = vi.fn();
    const { container } = render(
      <MessageList messages={messages} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={onRetry} />,
    );
    const assistantBubbles = container.querySelectorAll("[data-testid='message-bubble-assistant']");
    expect(assistantBubbles).toHaveLength(2);

    // Hover first assistant — no retry button
    fireEvent.mouseEnter(assistantBubbles[0]!);
    expect(assistantBubbles[0]!.querySelector("[data-testid='message-retry-btn']")).toBeNull();

    // Hover last assistant — retry button appears
    fireEvent.mouseEnter(assistantBubbles[1]!);
    expect(assistantBubbles[1]!.querySelector("[data-testid='message-retry-btn']")).toBeTruthy();
  });

  // Cycle 7: StreamingBubble
  it("renders streaming bubble when llmResponseStore status is streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("streaming text");
    const { getByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(getByTestId("streaming-bubble")).toBeTruthy();
    expect(getByTestId("streaming-bubble").textContent).toContain("streaming text");
  });

  it("shows streaming cursor ▍ during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("partial");
    const { getByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(getByTestId("streaming-bubble").textContent).toContain("▍");
  });

  it("does not render streaming bubble when status is idle", () => {
    const { queryByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(queryByTestId("streaming-bubble")).toBeNull();
  });

  it("does not render streaming bubble when status is done", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("done text");
    useLlmResponseStore.getState().finishStream();
    const { queryByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(queryByTestId("streaming-bubble")).toBeNull();
  });

  it("renders streaming text with markdown", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("**bold** text");
    const { getByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const bubble = getByTestId("streaming-bubble");
    expect(bubble.innerHTML).toContain("<strong>bold</strong>");
  });

  it("shows error message when status is error", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().setError("something broke");
    const { getByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    expect(getByTestId("streaming-error")).toBeTruthy();
    expect(getByTestId("streaming-error").textContent).toContain("something broke");
  });

  // Cycle 8: Auto-scroll
  function mockScrollGeometry(el: HTMLElement, opts: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
    Object.defineProperty(el, "scrollHeight", { value: opts.scrollHeight, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: opts.clientHeight, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: opts.scrollTop, configurable: true, writable: true });
  }

  it("scrolls to bottom when messages array changes", () => {
    const msgs1 = [makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" })];
    const { getByTestId, rerender } = render(
      <MessageList messages={msgs1} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const list = getByTestId("message-list");
    const scrollToSpy = vi.fn();
    list.scrollTo = scrollToSpy;
    mockScrollGeometry(list, { scrollHeight: 500, clientHeight: 300, scrollTop: 200 });

    const msgs2 = [
      ...msgs1,
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
    ];
    rerender(
      <MessageList messages={msgs2} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 500, behavior: "smooth" });
  });

  it("scrolls to bottom during streaming when user has not scrolled up", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("chunk1");
    const { getByTestId } = render(
      <MessageList messages={[]} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const list = getByTestId("message-list");
    const scrollToSpy = vi.fn();
    list.scrollTo = scrollToSpy;
    mockScrollGeometry(list, { scrollHeight: 500, clientHeight: 300, scrollTop: 200 });

    // Initial mount triggers scrollTo, clear to test streaming-specific scroll
    scrollToSpy.mockClear();

    act(() => {
      useLlmResponseStore.getState().appendChunk("chunk2");
    });

    expect(scrollToSpy).toHaveBeenCalled();
  });

  it("does not auto-scroll when user has scrolled up", () => {
    const msgs = [makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" })];
    const { getByTestId, rerender } = render(
      <MessageList messages={msgs} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const list = getByTestId("message-list");
    const scrollToSpy = vi.fn();
    list.scrollTo = scrollToSpy;

    // Simulate user scrolling up: scrollTop + clientHeight < scrollHeight
    mockScrollGeometry(list, { scrollHeight: 1000, clientHeight: 300, scrollTop: 100 });
    fireEvent.scroll(list);

    scrollToSpy.mockClear();

    const msgs2 = [
      ...msgs,
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
    ];
    rerender(
      <MessageList messages={msgs2} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  // Cycle 9: Editor action buttons integration
  it("does not show editor action buttons on latest assistant message during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("partial");
    const messages = [
      makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" }),
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
    ];
    const { container } = render(
      <MessageList messages={messages} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const lastAssistant = container.querySelectorAll("[data-testid='message-bubble-assistant']")[0]!;
    fireEvent.mouseEnter(lastAssistant);
    expect(lastAssistant.querySelector("[data-testid='message-insert-btn']")).toBeNull();
    expect(lastAssistant.querySelector("[data-testid='message-replace-btn']")).toBeNull();
  });

  it("shows Insert at cursor on latest assistant message when status is done and no editor selection", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("response");
    useLlmResponseStore.getState().finishStream();
    useEditorSelectionStore.getState().setSelection(0, 0);
    const messages = [
      makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" }),
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
    ];
    const { container } = render(
      <MessageList messages={messages} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const lastAssistant = container.querySelectorAll("[data-testid='message-bubble-assistant']")[0]!;
    fireEvent.mouseEnter(lastAssistant);
    expect(lastAssistant.querySelector("[data-testid='message-insert-btn']")).toBeTruthy();
  });

  it("shows Replace selection on latest assistant message when editor has selection", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("response");
    useLlmResponseStore.getState().finishStream();
    useEditorSelectionStore.getState().setSelection(0, 10);
    const messages = [
      makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" }),
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
    ];
    const { container } = render(
      <MessageList messages={messages} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const lastAssistant = container.querySelectorAll("[data-testid='message-bubble-assistant']")[0]!;
    fireEvent.mouseEnter(lastAssistant);
    expect(lastAssistant.querySelector("[data-testid='message-replace-btn']")).toBeTruthy();
    expect(lastAssistant.querySelector("[data-testid='message-insert-btn']")).toBeNull();
  });

  it("resumes auto-scroll when user scrolls back to bottom", () => {
    const msgs = [makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" })];
    const { getByTestId, rerender } = render(
      <MessageList messages={msgs} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );
    const list = getByTestId("message-list");
    const scrollToSpy = vi.fn();
    list.scrollTo = scrollToSpy;

    // Scroll up
    mockScrollGeometry(list, { scrollHeight: 1000, clientHeight: 300, scrollTop: 100 });
    fireEvent.scroll(list);
    scrollToSpy.mockClear();

    // Scroll back to bottom
    mockScrollGeometry(list, { scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    fireEvent.scroll(list);

    const msgs2 = [
      ...msgs,
      makeMessage({ id: 2, seq: 2, role: "assistant", content: "A1" }),
    ];
    rerender(
      <MessageList messages={msgs2} onEdit={vi.fn()} onEditSubmit={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(scrollToSpy).toHaveBeenCalled();
  });
});
