import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ThreadHeader } from "./ThreadHeader";
import { useLlmResponseStore } from "../stores/llmResponse";
import type { ConversationRow } from "../lib/ipc";

function makeConversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "conv-1",
    node_id: "node-1",
    anchor_type: null,
    anchor_id: null,
    title: "Test conversation",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ThreadHeader", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  it("renders ThreadSelector and New Thread button", () => {
    const conversations = [makeConversation({ id: "c1", title: "Thread 1" })];
    const { getByTestId } = render(
      <ThreadHeader
        conversations={conversations}
        activeConversationId="c1"
        onSelect={vi.fn()}
        onNewThread={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(getByTestId("thread-selector")).toBeTruthy();
    expect(getByTestId("new-thread-btn")).toBeTruthy();
  });

  it("calls onNewThread when New Thread button clicked", () => {
    const onNewThread = vi.fn();
    const { getByTestId } = render(
      <ThreadHeader
        conversations={[]}
        activeConversationId={null}
        onSelect={vi.fn()}
        onNewThread={onNewThread}
        onStop={vi.fn()}
      />,
    );
    fireEvent.click(getByTestId("new-thread-btn"));
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("shows Stop button during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    const { getByTestId } = render(
      <ThreadHeader
        conversations={[]}
        activeConversationId={null}
        onSelect={vi.fn()}
        onNewThread={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(getByTestId("conv-stop-btn")).toBeTruthy();
  });

  it("hides Stop button when not streaming", () => {
    const { queryByTestId } = render(
      <ThreadHeader
        conversations={[]}
        activeConversationId={null}
        onSelect={vi.fn()}
        onNewThread={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(queryByTestId("conv-stop-btn")).toBeNull();
  });

  it("calls onStop when Stop clicked", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    const onStop = vi.fn();
    const { getByTestId } = render(
      <ThreadHeader
        conversations={[]}
        activeConversationId={null}
        onSelect={vi.fn()}
        onNewThread={vi.fn()}
        onStop={onStop}
      />,
    );
    fireEvent.click(getByTestId("conv-stop-btn"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
