import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ThreadSelector } from "./ThreadSelector";
import type { ConversationRow } from "../lib/ipc";

function makeConversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "conv-1",
    node_id: "node-1",
    anchor_type: null,
    anchor_id: null,
    anchor_key: null,
    title: "First conversation",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ThreadSelector", () => {
  // Cycle 10: ThreadSelector rendering and selection

  it("renders select with conversation titles", () => {
    const conversations = [
      makeConversation({ id: "c1", title: "Alpha thread" }),
      makeConversation({ id: "c2", title: "Beta thread" }),
    ];
    const { getByTestId } = render(
      <ThreadSelector conversations={conversations} activeConversationId="c1" onSelect={vi.fn()} />,
    );
    const select = getByTestId("thread-selector") as HTMLSelectElement;
    expect(select.tagName).toBe("SELECT");
    const options = select.querySelectorAll("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.textContent).toBe("Alpha thread");
    expect(options[1]!.textContent).toBe("Beta thread");
  });

  it("uses truncated first user message as title when title is null", () => {
    const conversations = [
      makeConversation({
        id: "c1",
        title: null,
      }),
    ];
    const firstUserMessages: Record<string, string> = {
      c1: "What does paragraph 3 mean in the context of the introduction chapter",
    };
    const { getByTestId } = render(
      <ThreadSelector
        conversations={conversations}
        activeConversationId="c1"
        onSelect={vi.fn()}
        firstUserMessages={firstUserMessages}
      />,
    );
    const option = getByTestId("thread-selector").querySelector("option")!;
    expect(option.textContent).toBe("What does paragraph 3 mean in the context of the …");
  });

  it("shows 'Untitled thread' when title is null and no first user message available", () => {
    const conversations = [makeConversation({ id: "c1", title: null })];
    const { getByTestId } = render(
      <ThreadSelector conversations={conversations} activeConversationId="c1" onSelect={vi.fn()} />,
    );
    const option = getByTestId("thread-selector").querySelector("option")!;
    expect(option.textContent).toBe("Untitled thread");
  });

  it("marks active conversation as selected", () => {
    const conversations = [
      makeConversation({ id: "c1", title: "First" }),
      makeConversation({ id: "c2", title: "Second" }),
    ];
    const { getByTestId } = render(
      <ThreadSelector conversations={conversations} activeConversationId="c2" onSelect={vi.fn()} />,
    );
    const select = getByTestId("thread-selector") as HTMLSelectElement;
    expect(select.value).toBe("c2");
  });

  it("calls onSelect when a different conversation chosen", () => {
    const onSelect = vi.fn();
    const conversations = [
      makeConversation({ id: "c1", title: "First" }),
      makeConversation({ id: "c2", title: "Second" }),
    ];
    const { getByTestId } = render(
      <ThreadSelector conversations={conversations} activeConversationId="c1" onSelect={onSelect} />,
    );
    fireEvent.change(getByTestId("thread-selector"), { target: { value: "c2" } });
    expect(onSelect).toHaveBeenCalledWith("c2");
  });

  it("renders 'No threads' placeholder when conversations is empty", () => {
    const { getByTestId } = render(
      <ThreadSelector conversations={[]} activeConversationId={null} onSelect={vi.fn()} />,
    );
    const select = getByTestId("thread-selector") as HTMLSelectElement;
    expect(select.querySelector("option")!.textContent).toBe("No threads");
    expect(select.disabled).toBe(true);
  });

  // Bug #234: controlled <select> collapses to zero width when its `value`
  // (activeConversationId) matches no rendered <option>: a real browser sets
  // selectedIndex = -1 and renders the box blank. jsdom can't reproduce the
  // -1/zero-width behavior (it silently falls back to the first option), so we
  // assert the equivalent contract: when nothing matches, the active selection
  // must be the explicit placeholder ("") — never a silently-picked real thread.

  it("selects the placeholder (not a real thread) when active id matches nothing", () => {
    const conversations = [
      makeConversation({ id: "c1", title: "Alpha" }),
      makeConversation({ id: "c2", title: "Beta" }),
      makeConversation({ id: "c3", title: "Gamma" }),
    ];
    const { getByTestId } = render(
      <ThreadSelector
        conversations={conversations}
        activeConversationId="not-in-list"
        onSelect={vi.fn()}
      />,
    );
    const select = getByTestId("thread-selector") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("selects the placeholder when active id is null but threads exist", () => {
    const conversations = [
      makeConversation({ id: "c1", title: "Alpha" }),
      makeConversation({ id: "c2", title: "Beta" }),
    ];
    const { getByTestId } = render(
      <ThreadSelector conversations={conversations} activeConversationId={null} onSelect={vi.fn()} />,
    );
    const select = getByTestId("thread-selector") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("shows a placeholder option as the selection when nothing matches", () => {
    const conversations = [makeConversation({ id: "c1", title: "Alpha" })];
    const { getByTestId } = render(
      <ThreadSelector conversations={conversations} activeConversationId={null} onSelect={vi.fn()} />,
    );
    const select = getByTestId("thread-selector") as HTMLSelectElement;
    const selected = select.options[select.selectedIndex]!;
    expect(selected.value).toBe("");
    expect(selected.textContent).toBe("Select thread…");
  });

  it("does not add a placeholder option when the active id matches a thread", () => {
    const conversations = [
      makeConversation({ id: "c1", title: "Alpha" }),
      makeConversation({ id: "c2", title: "Beta" }),
    ];
    const { getByTestId } = render(
      <ThreadSelector conversations={conversations} activeConversationId="c2" onSelect={vi.fn()} />,
    );
    const select = getByTestId("thread-selector") as HTMLSelectElement;
    expect(select.value).toBe("c2");
    expect(select.querySelectorAll("option")).toHaveLength(2);
    expect(
      Array.from(select.options).some((o) => o.textContent === "Select thread…"),
    ).toBe(false);
  });
});
