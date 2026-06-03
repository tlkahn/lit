import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { useLlmResponseStore } from "../stores/llmResponse";
import { LlmResponsePanel } from "./LlmResponsePanel";

vi.mock("../lib/llmOrchestrator", () => ({
  cancelStream: vi.fn().mockResolvedValue(undefined),
}));
import { cancelStream } from "../lib/llmOrchestrator";

describe("LlmResponsePanel", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  // Cycle 6.1 — Renders streaming text
  it("renders streaming response text", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    useLlmResponseStore.getState().appendChunk("hello world");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("hello world");
  });

  it("shows question header while streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "summarize this" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("summarize this");
  });

  // Cycle 6.2 — Shows action buttons when done
  it("shows action buttons when status is done", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("response text");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-copy-btn']")).toBeTruthy();
  });

  it("does not show action buttons while streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("partial");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-copy-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='llm-companion-btn']")).toBeNull();
  });

  // Cycle 6.3 — Copy button
  it("copies response text to clipboard on Copy click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("copy me");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-copy-btn']")!);
    expect(writeText).toHaveBeenCalledWith("copy me");
  });

  // Cycle 6.5 — Error state
  it("renders error message when status is error", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().setError("something broke");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("something broke");
  });

  it("does not show action buttons on error", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().setError("fail");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-copy-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='llm-companion-btn']")).toBeNull();
  });

  // Idle state
  it("renders nothing meaningful when idle", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-response-text']")).toBeNull();
  });

  // Fix 4 — Markdown rendering
  it("renders markdown as HTML", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("**bold** text");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const el = container.querySelector("[data-testid='llm-response-text']");
    expect(el?.querySelector("strong")).toBeTruthy();
    expect(el?.textContent).not.toContain("**");
  });

  it("sanitizes script tags in response text", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk('<script>alert("xss")</script>Safe');
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const el = container.querySelector("[data-testid='llm-response-text']");
    expect(el?.querySelector("script")).toBeNull();
    expect(el?.textContent).toContain("Safe");
  });

  it("shows streaming cursor during streaming after markdown refactor", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("partial");
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.textContent).toContain("▍");
  });

  // --- Concern 4: Stop button ---

  it("shows stop button during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-stop-btn']")).toBeTruthy();
  });

  it("does not show stop button when done", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-stop-btn']")).toBeNull();
  });

  it("does not show stop button when idle", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-stop-btn']")).toBeNull();
  });

  it("calls cancelStream from orchestrator when stop button clicked", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-stop-btn']")!);
    expect(cancelStream).toHaveBeenCalled();
  });

  it("shows done-state UI after stopStream", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("partial response");
    useLlmResponseStore.getState().stopStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-stop-btn']")).toBeNull();
    expect(container.querySelector("[data-testid='llm-question-input']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-copy-btn']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-companion-btn']")).toBeTruthy();
    expect(container.textContent).toContain("[Stopped]");
  });

  // --- Concern 6: Textarea lifecycle ---

  it("shows textarea in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question-input']")).toBeTruthy();
  });

  it("does not show question header in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question']")).toBeNull();
  });

  it("hides textarea during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "what is X?" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question-input']")).toBeNull();
  });

  it("shows question header during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "what is X?" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const header = container.querySelector("[data-testid='llm-question']");
    expect(header).toBeTruthy();
    expect(header!.textContent).toBe("what is X?");
  });

  it("shows submit button in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-submit-btn']")).toBeTruthy();
  });

  // Submit calls onSubmit with plain question string
  it("calls onSubmit with plain question string", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "summarize" } });
    fireEvent.click(container.querySelector("[data-testid='llm-submit-btn']")!);
    expect(onSubmit).toHaveBeenCalledWith(
      "summarize",
      expect.objectContaining({ selectionText: "", selectionFrom: 0, selectionTo: 0, filePath: "" }),
    );
  });

  it("clears textarea after submit", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(container.querySelector("[data-testid='llm-submit-btn']")!);
    expect(textarea.value).toBe("");
  });

  it("submits on Cmd+Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test question" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSubmit).toHaveBeenCalledWith("test question", expect.objectContaining({ selectionText: "" }));
  });

  it("submits on Ctrl+Enter", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test question" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith("test question", expect.objectContaining({ selectionText: "" }));
  });

  it("disables submit button while streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const btn = container.querySelector("[data-testid='llm-submit-btn']");
    expect(btn).toBeNull();
  });

  it("shows textarea below response when done", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("answer");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-question']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-response-text']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-question-input']")).toBeTruthy();
    expect(container.querySelector("[data-testid='llm-submit-btn']")).toBeTruthy();
  });

  it("textarea is focused after streaming completes", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("answer");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });

  it("textarea is not auto-focused in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    expect(document.activeElement).not.toBe(textarea);
  });

  // --- Companion button ---

  it("shows companion button when status is done", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("response");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-companion-btn']")).toBeTruthy();
  });

  it("companion button dispatches lit:insert-companion-annotation with responseText", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("response");
    useLlmResponseStore.getState().finishStream();

    const handler = vi.fn();
    window.addEventListener("lit:insert-companion-annotation", handler);

    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-companion-btn']")!);

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.sourceAnnotation).toBeNull();
    expect(detail.responseText).toBe("response");

    window.removeEventListener("lit:insert-companion-annotation", handler);
  });

  it("does not dispatch companion event when responseText is empty", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().finishStream();

    const handler = vi.fn();
    window.addEventListener("lit:insert-companion-annotation", handler);

    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-companion-btn']")!);

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener("lit:insert-companion-annotation", handler);
  });

  // --- Styling & layout ---

  it("prose container has max-w-none class", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("response");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const el = container.querySelector("[data-testid='llm-response-text']");
    expect(el?.className).toContain("max-w-none");
  });

  it("links in rendered markdown have target=_blank and rel=noopener noreferrer", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("[click](https://example.com)");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const el = container.querySelector("[data-testid='llm-response-text']");
    const anchor = el?.querySelector("a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    expect(anchor?.getAttribute("rel")).toContain("noopener noreferrer");
  });

  it("submit button has accent background class", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const btn = container.querySelector("[data-testid='llm-submit-btn']") as HTMLElement;
    expect(btn.className).toContain("bg-interactive-accent");
  });

  it("textarea defaults to one row", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    expect(textarea.rows).toBe(1);
  });

  it("input is pinned to the bottom of the panel in idle state", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const panel = container.querySelector("[data-testid='llm-response-panel']") as HTMLElement;
    expect(panel.className).toContain("justify-end");
  });

  it("input wrapper aligns button to bottom of textarea", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLElement;
    const wrapper = textarea.parentElement!;
    expect(wrapper.className).toContain("items-end");
  });

  it("placeholder does not mention /insert or /rewrite", () => {
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    expect(textarea.placeholder).not.toContain("/insert");
    expect(textarea.placeholder).not.toContain("/rewrite");
  });

  // --- Default context ---

  it("uses default context when no editor responds to lit:llm-request-context", () => {
    const onSubmit = vi.fn();
    const { container } = render(<LlmResponsePanel contentHeight={300} onSubmit={onSubmit} />);
    const textarea = container.querySelector("[data-testid='llm-question-input']") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "test" } });
    fireEvent.click(container.querySelector("[data-testid='llm-submit-btn']")!);
    expect(onSubmit).toHaveBeenCalledWith(
      "test",
      { selectionText: "", selectionFrom: 0, selectionTo: 0, filePath: "" },
    );
  });

  // --- Cycle 10: Insert as companion button ---

  it("shows companion button even when fireSourceAnnotation is null", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("response");
    useLlmResponseStore.getState().finishStream();
    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    expect(container.querySelector("[data-testid='llm-companion-btn']")).toBeTruthy();
  });

  it("clicking companion button dispatches with fireSourceAnnotation when set", () => {
    const ann = {
      form: "compact" as const,
      annotation_type: "question" as const,
      certainty: "neutral" as const,
      scope: { kind: "sentence" as const, value: 1 },
      body: "why?",
      date: null,
      is_structured: true,
      char_start: 0,
      char_end: 14,
      original: "<!--- q | why? --->",
      uuid: null,
    };
    useLlmResponseStore.getState().startStream({
      question: "why?",
      fireSourceAnnotation: ann,
    });
    useLlmResponseStore.getState().appendChunk("the answer");
    useLlmResponseStore.getState().finishStream();

    const handler = vi.fn();
    window.addEventListener("lit:insert-companion-annotation", handler);

    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-companion-btn']")!);

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.sourceAnnotation).toBe(ann);
    expect(detail.responseText).toBe("the answer");

    window.removeEventListener("lit:insert-companion-annotation", handler);
  });

  it("clicking companion button dispatches with sourceAnnotation: null when fireSourceAnnotation not set", () => {
    useLlmResponseStore.getState().startStream({ question: "q" });
    useLlmResponseStore.getState().appendChunk("response");
    useLlmResponseStore.getState().finishStream();

    const handler = vi.fn();
    window.addEventListener("lit:insert-companion-annotation", handler);

    const { container } = render(<LlmResponsePanel contentHeight={300} />);
    fireEvent.click(container.querySelector("[data-testid='llm-companion-btn']")!);

    expect(handler).toHaveBeenCalledTimes(1);
    const detail = (handler.mock.calls[0]![0] as CustomEvent).detail;
    expect(detail.sourceAnnotation).toBeNull();
    expect(detail.responseText).toBe("response");

    window.removeEventListener("lit:insert-companion-annotation", handler);
  });
});
