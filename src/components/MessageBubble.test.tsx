import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MessageBubble } from "./MessageBubble";
import type { MessageRow } from "../lib/ipc";

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
});
