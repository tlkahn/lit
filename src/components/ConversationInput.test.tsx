import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ConversationInput } from "./ConversationInput";
import { useLlmResponseStore } from "../stores/llmResponse";

describe("ConversationInput", () => {
  beforeEach(() => {
    useLlmResponseStore.getState().reset();
  });

  it("renders textarea and send button", () => {
    const { getByTestId } = render(<ConversationInput onSend={vi.fn()} />);
    expect(getByTestId("conversation-input")).toBeTruthy();
    expect(getByTestId("conversation-send-btn")).toBeTruthy();
  });

  it("calls onSend with trimmed content on button click", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ConversationInput onSend={onSend} />);
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "  hello world  " } });
    fireEvent.click(getByTestId("conversation-send-btn"));
    expect(onSend).toHaveBeenCalledWith("hello world");
  });

  it("clears textarea after send", () => {
    const { getByTestId } = render(<ConversationInput onSend={vi.fn()} />);
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(getByTestId("conversation-send-btn"));
    expect(textarea.value).toBe("");
  });

  it("submits on Cmd+Enter", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ConversationInput onSend={onSend} />);
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "meta send" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledWith("meta send");
  });

  it("submits on Ctrl+Enter", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ConversationInput onSend={onSend} />);
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ctrl send" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(onSend).toHaveBeenCalledWith("ctrl send");
  });

  it("does not submit when input is empty", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ConversationInput onSend={onSend} />);
    fireEvent.click(getByTestId("conversation-send-btn"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not submit when input is only whitespace", () => {
    const onSend = vi.fn();
    const { getByTestId } = render(<ConversationInput onSend={onSend} />);
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "   " } });
    fireEvent.click(getByTestId("conversation-send-btn"));
    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not show send button during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    const { queryByTestId } = render(<ConversationInput onSend={vi.fn()} />);
    expect(queryByTestId("conversation-send-btn")).toBeNull();
  });

  it("auto-resizes textarea as content grows", () => {
    const { getByTestId } = render(<ConversationInput onSend={vi.fn()} />);
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    Object.defineProperty(textarea, "scrollHeight", { value: 80, configurable: true });
    fireEvent.change(textarea, { target: { value: "line1\nline2\nline3\nline4" } });
    expect(textarea.style.height).toBe("80px");
  });

  it("calls onNewThread on Cmd+N keydown", () => {
    const onNewThread = vi.fn();
    const { getByTestId } = render(
      <ConversationInput onSend={vi.fn()} onNewThread={onNewThread} />,
    );
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "n", metaKey: true });
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("calls onNewThread on Ctrl+N keydown", () => {
    const onNewThread = vi.fn();
    const { getByTestId } = render(
      <ConversationInput onSend={vi.fn()} onNewThread={onNewThread} />,
    );
    const textarea = getByTestId("conversation-input") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "n", ctrlKey: true });
    expect(onNewThread).toHaveBeenCalledTimes(1);
  });

  it("shows Stop button instead of Send during streaming", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    const { getByTestId, queryByTestId } = render(
      <ConversationInput onSend={vi.fn()} onStop={vi.fn()} />,
    );
    expect(getByTestId("conversation-stop-btn")).toBeTruthy();
    expect(queryByTestId("conversation-send-btn")).toBeNull();
  });

  it("shows Send button when not streaming", () => {
    const { getByTestId, queryByTestId } = render(
      <ConversationInput onSend={vi.fn()} onStop={vi.fn()} />,
    );
    expect(getByTestId("conversation-send-btn")).toBeTruthy();
    expect(queryByTestId("conversation-stop-btn")).toBeNull();
  });

  it("calls onStop when Stop clicked", () => {
    useLlmResponseStore.getState().startStream({ question: "test" });
    const onStop = vi.fn();
    const { getByTestId } = render(
      <ConversationInput onSend={vi.fn()} onStop={onStop} />,
    );
    fireEvent.click(getByTestId("conversation-stop-btn"));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
