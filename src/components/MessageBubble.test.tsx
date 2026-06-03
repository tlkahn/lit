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
  // Basic rendering
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

  it("renders user messages as markdown with prose styling", () => {
    const msg = makeMessage({ role: "user", content: "**bold text**" });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const bubble = getByTestId("message-bubble-user");
    expect(bubble.innerHTML).toContain("<strong>bold text</strong>");
  });

  it("sanitizes HTML in assistant messages", () => {
    const msg = makeMessage({ role: "assistant", content: '<script>alert("xss")</script>Safe' });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const bubble = getByTestId("message-bubble-assistant");
    expect(bubble.innerHTML).not.toContain("<script>");
    expect(bubble.textContent).toContain("Safe");
  });

  // Always-visible actions (no hover needed)
  it("shows action buttons without hover (always visible)", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} />);
    expect(getByTestId("message-copy-btn")).toBeTruthy();
    expect(getByTestId("message-edit-btn")).toBeTruthy();
  });

  // Copy button glyph
  it("copy button has nerd-font glyph and aria-label", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    const btn = getByTestId("message-copy-btn");
    expect(btn.getAttribute("aria-label")).toBe("Copy");
    const span = btn.querySelector(".nerd-font");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("");
    expect(span!.getAttribute("aria-hidden")).toBe("true");
  });

  it("copies message content to clipboard", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const msg = makeMessage({ role: "assistant", content: "copy this" });
    const { getByTestId } = render(<MessageBubble message={msg} />);
    fireEvent.click(getByTestId("message-copy-btn"));
    expect(writeText).toHaveBeenCalledWith("copy this");
  });

  // Edit button glyph
  it("edit button has nerd-font glyph and aria-label", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} />);
    const btn = getByTestId("message-edit-btn");
    expect(btn.getAttribute("aria-label")).toBe("Edit");
    const span = btn.querySelector(".nerd-font");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("");
  });

  it("shows edit button for user messages only", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} />);
    expect(getByTestId("message-edit-btn")).toBeTruthy();
  });

  it("does not show edit button for assistant messages", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello" });
    const { queryByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} />);
    expect(queryByTestId("message-edit-btn")).toBeNull();
  });

  // Retry button glyph
  it("retry button has nerd-font glyph and aria-label", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello" });
    const { getByTestId } = render(<MessageBubble message={msg} isLast onRetry={() => {}} />);
    const btn = getByTestId("message-retry-btn");
    expect(btn.getAttribute("aria-label")).toBe("Retry");
    const span = btn.querySelector(".nerd-font");
    expect(span).toBeTruthy();
    expect(span!.textContent).toBe("");
  });

  it("shows retry button for assistant messages when isLast is true", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello" });
    const { getByTestId } = render(<MessageBubble message={msg} isLast onRetry={() => {}} />);
    expect(getByTestId("message-retry-btn")).toBeTruthy();
  });

  it("does not show retry button when isLast is false", () => {
    const msg = makeMessage({ role: "assistant", content: "Hello" });
    const { queryByTestId } = render(<MessageBubble message={msg} isLast={false} onRetry={() => {}} />);
    expect(queryByTestId("message-retry-btn")).toBeNull();
  });

  it("calls onEdit callback with seq when edit clicked", () => {
    const onEdit = vi.fn();
    const msg = makeMessage({ role: "user", seq: 3 });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={onEdit} />);
    fireEvent.click(getByTestId("message-edit-btn"));
    expect(onEdit).toHaveBeenCalledWith(3);
  });

  it("calls onRetry callback when retry clicked", () => {
    const onRetry = vi.fn();
    const msg = makeMessage({ role: "assistant" });
    const { getByTestId } = render(<MessageBubble message={msg} isLast onRetry={onRetry} />);
    fireEvent.click(getByTestId("message-retry-btn"));
    expect(onRetry).toHaveBeenCalled();
  });

  // Inline edit mode
  it("entering edit mode shows textarea pre-filled with message content", () => {
    const msg = makeMessage({ role: "user", content: "original text" });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={() => {}} />);
    fireEvent.click(getByTestId("message-edit-btn"));
    const textarea = getByTestId("message-edit-textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("original text");
  });

  it("Cmd+Enter in edit textarea calls onEditSubmit with seq and new content", () => {
    const onEditSubmit = vi.fn();
    const msg = makeMessage({ role: "user", content: "original", seq: 5 });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={onEditSubmit} />);
    fireEvent.click(getByTestId("message-edit-btn"));
    const textarea = getByTestId("message-edit-textarea");
    fireEvent.change(textarea, { target: { value: "edited content" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onEditSubmit).toHaveBeenCalledWith(5, "edited content");
  });

  it("Escape cancels edit mode and restores original display", () => {
    const msg = makeMessage({ role: "user", content: "original text" });
    const { getByTestId, queryByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={() => {}} />);
    fireEvent.click(getByTestId("message-edit-btn"));
    expect(getByTestId("message-edit-textarea")).toBeTruthy();
    fireEvent.keyDown(getByTestId("message-edit-textarea"), { key: "Escape" });
    expect(queryByTestId("message-edit-textarea")).toBeNull();
    expect(getByTestId("message-bubble-user").textContent).toContain("original text");
  });

  it("edit textarea auto-focuses on entering edit mode", () => {
    const msg = makeMessage({ role: "user", content: "focus me" });
    const { getByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={() => {}} />);
    fireEvent.click(getByTestId("message-edit-btn"));
    const textarea = getByTestId("message-edit-textarea");
    expect(document.activeElement).toBe(textarea);
  });

  // Insert as companion button glyph
  it("companion button has nerd-font glyph and aria-label", () => {
    const msg = makeMessage({ role: "assistant", content: "Generated text" });
    const { getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions />,
    );
    const btn = getByTestId("message-companion-btn");
    expect(btn.getAttribute("aria-label")).toBe("Insert as companion");
    const span = btn.querySelector(".nerd-font");
    expect(span).toBeTruthy();
  });

  it("shows companion button without fireSourceAnnotation", () => {
    const msg = makeMessage({ role: "assistant", content: "Generated text" });
    const { getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions />,
    );
    expect(getByTestId("message-companion-btn")).toBeTruthy();
  });

  it("does not show companion button when showEditorActions is false", () => {
    const msg = makeMessage({ role: "assistant", content: "Old response" });
    const { queryByTestId } = render(
      <MessageBubble message={msg} isLast={false} showEditorActions={false} />,
    );
    expect(queryByTestId("message-companion-btn")).toBeNull();
  });

  // Edit mode hides actions (regression)
  it("entering edit mode hides all action buttons", () => {
    const msg = makeMessage({ role: "user", content: "Hello" });
    const { getByTestId, queryByTestId } = render(<MessageBubble message={msg} onEdit={() => {}} onEditSubmit={() => {}} />);
    expect(getByTestId("message-copy-btn")).toBeTruthy();
    fireEvent.click(getByTestId("message-edit-btn"));
    expect(queryByTestId("message-copy-btn")).toBeNull();
    expect(queryByTestId("message-edit-btn")).toBeNull();
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
    const { getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions fireSourceAnnotation={annotation} />,
    );
    fireEvent.click(getByTestId("message-companion-btn"));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ sourceAnnotation: annotation, responseText: "Companion text" });
    window.removeEventListener("lit:insert-companion-annotation", handler as EventListener);
  });

  it("dispatches companion annotation with sourceAnnotation: null when fireSourceAnnotation not set", () => {
    const handler = vi.fn();
    window.addEventListener("lit:insert-companion-annotation", handler as EventListener);
    const msg = makeMessage({ role: "assistant", content: "Companion text" });
    const { getByTestId } = render(
      <MessageBubble message={msg} isLast showEditorActions />,
    );
    fireEvent.click(getByTestId("message-companion-btn"));
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]![0] as CustomEvent;
    expect(event.detail).toEqual({ sourceAnnotation: null, responseText: "Companion text" });
    window.removeEventListener("lit:insert-companion-annotation", handler as EventListener);
  });
});
