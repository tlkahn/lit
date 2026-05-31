import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { MessageBubble } from "./MessageBubble";
import type { MessageRow } from "../lib/ipc";
import * as renderMarkdownModule from "../lib/renderMarkdown";

function makeAnnotation() {
  return {
    form: "compact" as const,
    annotation_type: "note" as const,
    certainty: "neutral" as const,
    scope: { kind: "words" as const, value: 1 },
    body: "test",
    date: null,
    is_structured: false,
    char_start: 0,
    char_end: 10,
    original: "test",
    uuid: null,
  };
}

function makeMessage(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 1,
    conversation_id: "conv-1",
    role: "user",
    content: "Hello world",
    seq: 1,
    created_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("MessageBubble", () => {
  // Cycle 2: Basic rendering
  it("renders user message content with data-testid message-bubble-user", () => {
    const msg = makeMessage({ role: "user", content: "Hello from user" });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const bubble = getByTestId("message-bubble-user");
    expect(bubble.textContent).toContain("Hello from user");
  });

  it("renders assistant message content with data-testid message-bubble-assistant", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello from assistant" });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const bubble = getByTestId("message-bubble-assistant");
    expect(bubble.textContent).toContain("Hello from assistant");
  });

  it("renders markdown in assistant messages", () => {
    const msg = makeMessage({ role: "assistant", content: "**bold**" });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const bubble = getByTestId("message-bubble-assistant");
    expect(bubble.innerHTML).toContain("<strong>bold</strong>");
  });

  it("renders user messages as plain text", () => {
    const msg = makeMessage({ role: "user", content: "**not bold**" });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const bubble = getByTestId("message-bubble-user");
    expect(bubble.innerHTML).not.toContain("<strong>");
    expect(bubble.textContent).toContain("**not bold**");
  });

  it("sanitizes HTML in assistant messages", () => {
    const msg = makeMessage({ role: "assistant", content: '<script>alert("xss")</script>Safe' });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const bubble = getByTestId("message-bubble-assistant");
    expect(bubble.innerHTML).not.toContain("<script>");
    expect(bubble.textContent).toContain("Safe");
  });

  // Cycle 3: Hover actions — Copy
  it("does not show action buttons by default", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { container } = render(<MessageBubble message={msg} />);
    expect(container.querySelector("[data-testid='message-copy-btn']")).toBeNull();
  });

  it("shows copy button on mouseEnter", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { container, getByTestId } = render(<MessageBubble message={msg} />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(getByTestId("message-copy-btn")).toBeTruthy();
  });

  it("hides actions on mouseLeave", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { container } = render(<MessageBubble message={msg} />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(container.querySelector("[data-testid='message-copy-btn']")).toBeTruthy();
    fireEvent.mouseLeave(container.firstChild!);
    expect(container.querySelector("[data-testid='message-copy-btn']")).toBeNull();
  });

  it("copies message content to clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const msg = makeMessage({ role: "assistant", content: "copy this" });
    const { container, getByTestId } = render(<MessageBubble message={msg} />);
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-copy-btn"));
    expect(writeText).toHaveBeenCalledWith("copy this");
  });

  // Cycle 4: Hover actions — Edit and Retry
  it("shows edit button on hover for user messages only", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { container, getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(getByTestId("message-edit-btn")).toBeTruthy();
  });

  it("does not show edit button for assistant messages", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello" });
    const { container } = render(<MessageBubble message={msg} onEdit={() => {}} />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(container.querySelector("[data-testid='message-edit-btn']")).toBeNull();
  });

  it("shows retry button on hover for assistant messages when isLast is true", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello" });
    const { container, getByTestId } = render(<MessageBubble message={msg} isLast onRetry={() => {}} />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(getByTestId("message-retry-btn")).toBeTruthy();
  });

  it("does not show retry button when isLast is false", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello" });
    const { container } = render(<MessageBubble message={msg} isLast={false} onRetry={() => {}} />);
    fireEvent.mouseEnter(container.firstChild!);
    expect(container.querySelector("[data-testid='message-retry-btn']")).toBeNull();
  });

  it("calls onEdit callback with seq when edit clicked", () => {
    const onEdit = vi.fn();
    const msg = makeMessage({ role: "user", seq: 3 });
    const { container, getByTestId } = render(<MessageBubble message={msg} onEdit={onEdit} />);
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-edit-btn"));
    expect(onEdit).toHaveBeenCalledWith(3);
  });

  it("calls onRetry callback when retry clicked", () => {
    const onRetry = vi.fn();
    const msg = makeMessage({ role: "assistant" });
    const { container, getByTestId } = render(<MessageBubble message={msg} isLast onRetry={onRetry} />);
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-retry-btn"));
    expect(onRetry).toHaveBeenCalled();
  });

  // Cycle 5: Inline edit mode
  it("entering edit mode shows textarea pre-filled with message content", () => {
    const msg = makeMessage({ role: "user", content: "original text" });
    const { container, getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={() => {}} />);
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-edit-btn"));
    const textarea = getByTestId("message-edit-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("original text");
  });

  it("Cmd+Enter in edit textarea calls onEditSubmit with seq and new content", () => {
    const onEditSubmit = vi.fn();
    const msg = makeMessage({ role: "user", content: "original", seq: 5 });
    const { container, getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={onEditSubmit} />);
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-edit-btn"));
    const textarea = getByTestId("message-edit-textarea");
    fireEvent.change(textarea, { target: { value: "edited content" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onEditSubmit).toHaveBeenCalledWith(5, "edited content");
  });

  it("Escape cancels edit mode and restores original display", () => {
    const msg = makeMessage({ role: "user", content: "original text" });
    const { container, getByTestId, queryByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={() => {}} />);
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-edit-btn"));
    expect(getByTestId("message-edit-textarea")).toBeTruthy();
    fireEvent.keyDown(getByTestId("message-edit-textarea"), { key: "Escape" });
    expect(queryByTestId("message-edit-textarea")).toBeNull();
    expect(getByTestId("message-bubble-user").textContent).toContain("original text");
  });

  it("edit textarea auto-focuses on entering edit mode", () => {
    const msg = makeMessage({ role: "user", content: "focus me" });
    const { container, getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={() => {}} />);
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-edit-btn"));
    const textarea = getByTestId("message-edit-textarea");
    expect(document.activeElement).toBe(textarea);
  });

  // Cycle 9: Editor action buttons on latest assistant message
  it("shows Insert at cursor button on latest assistant message when no editor selection", () => {
    const msg = makeMessage({ role: "assistant", content: "Generated text" });
    const { container, getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions hadSelection={false} />,
    );
    fireEvent.mouseEnter(container.firstChild!);
    expect(getByTestId("message-insert-btn")).toBeTruthy();
    expect(getByTestId("message-insert-btn").textContent).toBe("Insert at cursor");
  });

  it("shows Replace selection button when editor has selection", () => {
    const msg = makeMessage({ role: "assistant", content: "Generated text" });
    const { container, getByTestId, queryByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions hadSelection />,
    );
    fireEvent.mouseEnter(container.firstChild!);
    expect(getByTestId("message-replace-btn")).toBeTruthy();
    expect(getByTestId("message-replace-btn").textContent).toBe("Replace selection");
    expect(queryByTestId("message-insert-btn")).toBeNull();
  });

  it("shows Insert as companion button when fireSourceAnnotation is set", () => {
    const annotation = makeAnnotation();
    const msg = makeMessage({ role: "assistant", content: "Generated text" });
    const { container, getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions hadSelection={false} fireSourceAnnotation={annotation} />,
    );
    fireEvent.mouseEnter(container.firstChild!);
    expect(getByTestId("message-companion-btn")).toBeTruthy();
    expect(getByTestId("message-companion-btn").textContent).toBe("Insert as companion");
  });

  it("does not show Insert/Replace on non-latest assistant messages", () => {
    const msg = makeMessage({ role: "assistant", content: "Old response" });
    const { container, queryByTestId } = render(
      <MessageBubble message={msg} isLast={false} showEditorActions={false} hadSelection={false} />,
    );
    fireEvent.mouseEnter(container.firstChild!);
    expect(queryByTestId("message-insert-btn")).toBeNull();
    expect(queryByTestId("message-replace-btn")).toBeNull();
    expect(queryByTestId("message-companion-btn")).toBeNull();
  });

  it("dispatches lit:llm-insert-raw on Insert click", () => {
    const handler = vi.fn();
    window.addEventListener("lit:llm-insert-raw", handler as EventListener);
    const msg = makeMessage({ role: "assistant", content: "Insert this" });
    const { container, getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions hadSelection={false} />,
    );
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-insert-btn"));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ text: "Insert this" });
    window.removeEventListener("lit:llm-insert-raw", handler as EventListener);
  });

  it("does not re-call renderMarkdown when re-rendered with same content", () => {
    const spy = vi.spyOn(renderMarkdownModule, "renderMarkdown");
    const msg = makeMessage({ role: "assistant", content: "**hello**" });
    const { rerender } = render(<MessageBubble message={msg} />);
    const initialCount = spy.mock.calls.length;
    rerender(<MessageBubble message={msg} />);
    expect(spy.mock.calls.length).toBe(initialCount);
    spy.mockRestore();
  });

  it("skips re-render when parent re-renders with identical props", () => {
    const spy = vi.spyOn(renderMarkdownModule, "renderMarkdown");
    const msg = makeMessage({ role: "assistant", content: "**stable**" });
    const onEdit = () => {};

    function Parent() {
      const [, setTick] = useState(0);
      return (
        <>
          <button data-testid="force-rerender" onClick={() => setTick((t) => t + 1)} />
          <MessageBubble message={msg} onEdit={onEdit} />
        </>
      );
    }

    const { getByTestId } = render(<Parent />);
    const countAfterMount = spy.mock.calls.length;
    fireEvent.click(getByTestId("force-rerender"));
    expect(spy.mock.calls.length).toBe(countAfterMount);
    spy.mockRestore();
  });

  it("dispatches lit:insert-companion-annotation on Companion click", () => {
    const handler = vi.fn();
    window.addEventListener("lit:insert-companion-annotation", handler as EventListener);
    const annotation = makeAnnotation();
    const msg = makeMessage({ role: "assistant", content: "Companion text" });
    const { container, getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions hadSelection={false} fireSourceAnnotation={annotation} />,
    );
    fireEvent.mouseEnter(container.firstChild!);
    fireEvent.click(getByTestId("message-companion-btn"));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ sourceAnnotation: annotation, responseText: "Companion text" });
    window.removeEventListener("lit:insert-companion-annotation", handler as EventListener);
  });
});
