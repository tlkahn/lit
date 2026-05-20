import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useLlmResponseStore } from "../stores/llmResponse";
import { LlmResponsePanel, wrapCallout } from "./LlmResponsePanel";

vi.mock("../lib/llmClient", () => ({
  cancelLlmStream: vi.fn().mockResolvedValue(undefined),
}));
import { cancelLlmStream } from "../lib/llmClient";

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

  // Fix 1 — wrapCallout empty text
  it("returns empty string when text is empty", () => {
    expect(wrapCallout("")).toBe("");
  });

  // Fix 4 — Markdown rendering
  it("renders markdown as HTML", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("**bold** text");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const el = container.querySelector("[data-testid='llm-response-text']");
    expect(el?.querySelector("strong")).toBeTruthy();
    expect(el?.textContent).not.toContain("**");
  });

  it("sanitizes script tags in response text", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk('<script>alert("xss")</script>Safe');
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const el = container.querySelector("[data-testid='llm-response-text']");
    expect(el?.querySelector("script")).toBeNull();
    expect(el?.textContent).toContain("Safe");
  });

  it("shows streaming cursor during streaming after markdown refactor", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("partial");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("▍");
  });

  it("does not dispatch insert event when responseText is empty", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().finishStream();
    const handler = vi.fn();
    window.addEventListener("lit:llm-insert-response", handler);
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-insert-btn']")!);
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener("lit:llm-insert-response", handler);
  });

  // --- Concern 4: Stop button ---

  it("shows stop button during streaming", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-stop-btn']")).toBeTruthy();
  });

  it("does not show stop button when done", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-stop-btn']")).toBeNull();
  });

  it("does not show stop button when idle", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-stop-btn']")).toBeNull();
  });

  it("calls cancelLlmStream when stop button clicked", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-stop-btn']")!);
    expect(cancelLlmStream).toHaveBeenCalled();
  });

  // --- Concern 6: Textarea lifecycle ---

  // 6.1 — Textarea renders in idle state
  it("shows textarea in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question-input']")).toBeTruthy();
  });

  it("does not show question header in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question']")).toBeNull();
  });

  // 6.2 — Textarea hidden during streaming, question header shown
  it("hides textarea during streaming", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "what is X?" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question-input']")).toBeNull();
  });

  it("shows question header during streaming", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "what is X?" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const header = container.querySelector("[data-testid='llm-question']");
    expect(header).toBeTruthy();
    expect(header!.textContent).toBe("what is X?");
  });

  // 6.3 — Submit button renders alongside textarea
  it("shows submit button in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-submit-btn']")).toBeTruthy();
  });

  // 6.4 — Submit parses prefix and calls onSubmit
  it("parses prefix and calls onSubmit on submit", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/insert summarize" } });
    fireEvent.click(container.querySelector("[data-testid='llm-submit-btn']")!);
    expect(onSubmit).toHaveBeenCalledWith(
      { prefix: "insert", question: "summarize" },
      expect.objectContaining({ selectionText: "", selectionFrom: 0, selectionTo: 0, filePath: "" }),
    );
  });

  // 6.5 — Textarea clears after submit
  it("clears textarea after submit", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(container.querySelector("[data-testid='llm-submit-btn']")!);
    expect(textarea.value).toBe("");
  });

  // 6.6 — Cmd+Enter submits
  it("submits on Cmd+Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test question" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalled();
  });

  it("submits on Ctrl+Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test question" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalled();
  });

  // 6.7 — Submit disabled while streaming
  it("disables submit button while streaming", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const btn = container.querySelector("[data-testid='llm-submit-btn']");
    expect(btn).toBeNull();
  });

  // 6.8 — Fresh textarea below response when done
  it("shows textarea below response when done", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("answer");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-response-text']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-question-input']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-submit-btn']")).toBeTruthy();
  });

  // --- Concern 3: Raw insert for /insert ---

  // 3.1 — /insert dispatches lit:llm-insert-raw with raw text
  it("dispatches lit:llm-insert-raw with raw text for /insert prefix", () => {
    useLlmResponseStore.getState().startStream({ prefix: "insert", question: "summarize" });
    useLlmResponseStore.getState().appendChunk("summary");
    useLlmResponseStore.getState().finishStream();

    const rawHandler = vi.fn();
    const responseHandler = vi.fn();
    window.addEventListener("lit:llm-insert-raw", rawHandler);
    window.addEventListener("lit:llm-insert-response", responseHandler);

    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-insert-btn']")!);

    expect(rawHandler).toHaveBeenCalledTimes(1);
    expect((rawHandler.mock.calls[0]![0] as CustomEvent).detail.text).toBe("summary");
    expect(responseHandler).not.toHaveBeenCalled();

    window.removeEventListener("lit:llm-insert-raw", rawHandler);
    window.removeEventListener("lit:llm-insert-response", responseHandler);
  });

  // 3.2 — /ask still dispatches callout-wrapped event
  it("dispatches lit:llm-insert-response with callout for /ask prefix", () => {
    useLlmResponseStore.getState().startStream({ prefix: "ask", question: "q" });
    useLlmResponseStore.getState().appendChunk("answer");
    useLlmResponseStore.getState().finishStream();

    const rawHandler = vi.fn();
    const responseHandler = vi.fn();
    window.addEventListener("lit:llm-insert-raw", rawHandler);
    window.addEventListener("lit:llm-insert-response", responseHandler);

    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-insert-btn']")!);

    expect(responseHandler).toHaveBeenCalledTimes(1);
    expect((responseHandler.mock.calls[0]![0] as CustomEvent).detail.text).toBe("> [!llm]+ Response\n> answer");
    expect(rawHandler).not.toHaveBeenCalled();

    window.removeEventListener("lit:llm-insert-raw", rawHandler);
    window.removeEventListener("lit:llm-insert-response", responseHandler);
  });

  // --- Concern 2: Safe context callback ---

  // 2.3 — Submit works even without editor mounted (default context)
  it("uses default context when no editor responds to lit:llm-request-context", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.click(container.querySelector("[data-testid='llm-submit-btn']")!);
    expect(onSubmit).toHaveBeenCalledWith(
      { prefix: "ask", question: "test" },
      { selectionText: "", selectionFrom: 0, selectionTo: 0, filePath: "" },
    );
  });

  // 2.4 — /rewrite without selection shows error
  it("shows error for /rewrite without selection", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "/rewrite make it concise" } });
    fireEvent.click(container.querySelector("[data-testid='llm-submit-btn']")!);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(container.querySelector("[data-testid='llm-rewrite-error']")).toBeTruthy();
  });
});
