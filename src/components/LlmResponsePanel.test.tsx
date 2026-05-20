import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useLlmResponseStore } from "../stores/llmResponse";
import { LlmResponsePanel } from "./LlmResponsePanel";

describe("LlmResponsePanel", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  // Cycle 6.1 — Renders streaming text
  it("renders streaming response text", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "test" });
    useLlmResponseStore.getState().appendChunk("hello world");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("hello world");
  });

  it("shows question header while streaming", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "summarize this" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("summarize this");
  });

  // Cycle 6.2 — Shows action buttons when done
  it("shows action buttons when status is done", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("response text");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-copy-btn']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-insert-btn']")).toBeTruthy();
  });

  it("does not show action buttons while streaming", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("partial");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-copy-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='llm-insert-btn']")).toBeNull();
  });

  // Cycle 6.3 — Copy button
  it("copies response text to clipboard on Copy click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("copy me");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-copy-btn']")!);
    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  // Cycle 6.4 — Insert at cursor button
  it("dispatches lit:llm-insert-response with callout-wrapped text on Insert click", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("line1\nline2");
    useLlmResponseStore.getState().finishStream();

    const handler = vi.fn();
    window.addEventListener("lit:llm-insert-response", handler);

    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-insert-btn']")!);

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.text).toBe("> [!llm]+ Response\n> line1\n> line2");

    window.removeEventListener("lit:llm-insert-response", handler);
  });

  // Cycle 6.5 — Error state
  it("renders error message when status is error", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().setError("something broke");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("something broke");
  });

  it("does not show action buttons on error", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().setError("fail");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-copy-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='llm-insert-btn']")).toBeNull();
  });

  // Idle state
  it("renders nothing meaningful when idle", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-response-text']")).toBeNull();
  });
});
