import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, act, fireEvent } from "@testing-library/react";
import { useConversationStore } from "../stores/conversation";
import { useLlmResponseStore } from "../stores/llmResponse";
import { usePreferencesStore } from "../stores/preferences";

vi.mock("../lib/ipc", () => ({
  conversationList: vi.fn(),
  conversationCreate: vi.fn(),
  conversationDelete: vi.fn(),
  conversationMessages: vi.fn(),
  conversationGet: vi.fn(),
  conversationAddMessage: vi.fn(),
  conversationDeleteMessagesAfter: vi.fn(),
  GLOBAL_NODE_ID: "_global",
}));

vi.mock("../lib/llmClient", () => ({
  startLlmStream: vi.fn(),
  cancelLlmStream: vi.fn(),
}));

import {
  conversationList,
  conversationMessages,
} from "../lib/ipc";
import type { ConversationRow, MessageRow } from "../lib/ipc";

import { ConversationPanel } from "./ConversationPanel";

const mockedConversationList = conversationList as Mock;
const mockedConversationMessages = conversationMessages as Mock;

function makeConversation(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: "conv-1",
    node_id: "page-1",
    anchor_type: null,
    anchor_id: null,
    title: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

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

describe("ConversationPanel", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useLlmResponseStore.getState().reset();
    vi.clearAllMocks();
    mockedConversationList.mockResolvedValue([]);
    mockedConversationMessages.mockResolvedValue([]);
  });

  // Cycle 14: Load conversations on mount
  it("calls loadConversations with pageId on mount", async () => {
    mockedConversationList.mockResolvedValue([]);
    await act(async () => {
      render(<ConversationPanel pageId="page-1" />);
    });
    expect(mockedConversationList).toHaveBeenCalledWith("page-1");
  });

  it("re-loads conversations when pageId changes", async () => {
    mockedConversationList.mockResolvedValue([]);
    const { rerender } = render(<ConversationPanel pageId="page-1" />);
    await act(async () => {});

    mockedConversationList.mockClear();
    await act(async () => {
      rerender(<ConversationPanel pageId="page-2" />);
    });
    expect(mockedConversationList).toHaveBeenCalledWith("page-2");
  });

  it("selects most recent conversation after load when none is active", async () => {
    const convs = [
      makeConversation({ id: "old", created_at: "2025-01-01T00:00:00Z" }),
      makeConversation({ id: "recent", created_at: "2025-06-01T00:00:00Z" }),
    ];
    mockedConversationList.mockResolvedValue(convs);
    mockedConversationMessages.mockResolvedValue([]);

    await act(async () => {
      render(<ConversationPanel pageId="page-1" />);
    });

    expect(useConversationStore.getState().activeConversationId).toBe("recent");
  });

  // Cycle 15: Renders all sub-components
  it("renders ThreadHeader", async () => {
    mockedConversationList.mockResolvedValue([]);
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });
    expect(result!.getByTestId("new-thread-btn")).toBeTruthy();
  });

  it("renders MessageList with messages from store", async () => {
    const conv = makeConversation({ id: "conv-1" });
    mockedConversationList.mockResolvedValue([conv]);
    mockedConversationMessages.mockResolvedValue([
      makeMessage({ id: 1, seq: 1, role: "user", content: "Q1" }),
    ]);

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });
    expect(result!.getByTestId("message-list")).toBeTruthy();
    expect(result!.getByTestId("message-bubble-user")).toBeTruthy();
  });

  it("renders ConversationInput", async () => {
    mockedConversationList.mockResolvedValue([]);
    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });
    expect(result!.getByTestId("conversation-input")).toBeTruthy();
  });

  // Cycle 16: Lazy conversation creation on first send
  //
  // These tests replace store actions with spies to isolate orchestration
  // logic in ConversationPanel from the real store's IPC calls.

  it("creates conversation on first send when no active conversation exists", async () => {
    const createConversationSpy = vi.fn().mockResolvedValue("new-conv-id");
    const sendMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      sendMessage: sendMessageSpy,
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const textarea = result!.getByTestId("conversation-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Hello there, how are you?" } });
    });
    await act(async () => {
      fireEvent.click(result!.getByTestId("conversation-send-btn"));
    });

    expect(createConversationSpy).toHaveBeenCalledWith("page-1", "Hello there, how are you?".slice(0, 50));
    expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      content: "Hello there, how are you?",
      model: expect.any(String),
    }));
  });

  it("sends message with model and system from preferences store", async () => {
    const sendMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      sendMessage: sendMessageSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });
    usePreferencesStore.setState({
      llmModel: "gpt-4",
      llmSystemPrompt: "Be helpful",
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const textarea = result!.getByTestId("conversation-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "test message" } });
    });
    await act(async () => {
      fireEvent.click(result!.getByTestId("conversation-send-btn"));
    });

    expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      content: "test message",
      model: "gpt-4",
      system: "Be helpful",
    }));
  });

  it("does not create new conversation on subsequent sends", async () => {
    const createConversationSpy = vi.fn().mockResolvedValue("conv-1");
    const sendMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      sendMessage: sendMessageSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const textarea = result!.getByTestId("conversation-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "test" } });
    });
    await act(async () => {
      fireEvent.click(result!.getByTestId("conversation-send-btn"));
    });

    expect(createConversationSpy).not.toHaveBeenCalled();
  });

  // Cycle 17: Thread selection and creation
  it("calls selectConversation when thread selector changes", async () => {
    const selectConversationSpy = vi.fn().mockResolvedValue(undefined);
    const convs = [
      makeConversation({ id: "conv-1", title: "Thread 1" }),
      makeConversation({ id: "conv-2", title: "Thread 2" }),
    ];
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      selectConversation: selectConversationSpy,
      activeConversationId: "conv-1",
      conversations: convs,
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const selector = result!.getByTestId("thread-selector") as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(selector, { target: { value: "conv-2" } });
    });

    expect(selectConversationSpy).toHaveBeenCalledWith("conv-2");
  });

  it("calls createConversation when New Thread button clicked", async () => {
    const createConversationSpy = vi.fn().mockResolvedValue("new-id");
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    await act(async () => {
      fireEvent.click(result!.getByTestId("new-thread-btn"));
    });

    expect(createConversationSpy).toHaveBeenCalledWith("page-1");
  });

  it("clears messages and resets for the new thread", async () => {
    const createConversationSpy = vi.fn().mockImplementation(async () => {
      useConversationStore.setState({ activeConversationId: "new-id", messages: [] });
      return "new-id";
    });
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [makeMessage({ id: 1, seq: 1, content: "old message" })],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    expect(result!.getByText("old message")).toBeTruthy();

    await act(async () => {
      fireEvent.click(result!.getByTestId("new-thread-btn"));
    });

    expect(result!.queryByText("old message")).toBeNull();
  });

  // Cycle 18: Edit and retry wiring
  it("calls editMessage with seq, new content, model, and system when edit submitted", async () => {
    const editMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      editMessage: editMessageSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [
        makeMessage({ id: 1, seq: 1, role: "user", content: "original question" }),
        makeMessage({ id: 2, seq: 2, role: "assistant", content: "response" }),
      ],
    });
    usePreferencesStore.setState({
      llmModel: "gpt-4",
      llmSystemPrompt: "Be helpful",
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const userBubble = result!.getByTestId("message-bubble-user");
    fireEvent.mouseEnter(userBubble);
    const editBtn = result!.getByTestId("message-edit-btn");
    fireEvent.click(editBtn);

    const textarea = userBubble.querySelector("textarea")!;
    fireEvent.change(textarea, { target: { value: "edited question" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });

    expect(editMessageSpy).toHaveBeenCalledWith(1, "edited question", {
      model: "gpt-4",
      system: "Be helpful",
      nodeId: "page-1",
      neighborsDepth: 1,
    });
  });

  it("calls retryLastMessage with model and system when retry triggered", async () => {
    const retryLastMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      retryLastMessage: retryLastMessageSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [
        makeMessage({ id: 1, seq: 1, role: "user", content: "question" }),
        makeMessage({ id: 2, seq: 2, role: "assistant", content: "answer" }),
      ],
    });
    usePreferencesStore.setState({
      llmModel: "gpt-4",
      llmSystemPrompt: "Be helpful",
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const assistantBubble = result!.getByTestId("message-bubble-assistant");
    fireEvent.mouseEnter(assistantBubble);
    const retryBtn = result!.getByTestId("message-retry-btn");
    fireEvent.click(retryBtn);

    expect(retryLastMessageSpy).toHaveBeenCalledWith({
      model: "gpt-4",
      system: "Be helpful",
      nodeId: "page-1",
      neighborsDepth: 1,
    });
  });

  // Cycle 19: Stop/cancel wiring
  it("calls cancelConversationStream when stop button clicked in header", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      cancelConversationStream: cancelSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });
    useLlmResponseStore.getState().startStream({ question: "test" });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    fireEvent.click(result!.getByTestId("conv-stop-btn"));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  it("calls cancelConversationStream when stop button clicked in input area", async () => {
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      cancelConversationStream: cancelSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });
    useLlmResponseStore.getState().startStream({ question: "test" });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    fireEvent.click(result!.getByTestId("conversation-stop-btn"));
    expect(cancelSpy).toHaveBeenCalledTimes(1);
  });

  // Cycle 20: Error display
  it("displays conversation store error when set", async () => {
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      activeConversationId: null,
      conversations: [],
      messages: [],
      error: "Something went wrong",
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    expect(result!.getByTestId("conversation-error")).toBeTruthy();
    expect(result!.getByTestId("conversation-error").textContent).toContain("Something went wrong");
  });

  it("does not display error when error is null", async () => {
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      activeConversationId: null,
      conversations: [],
      messages: [],
      error: null,
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    expect(result!.queryByTestId("conversation-error")).toBeNull();
  });

  // Cycle 23: Auto-focus on new thread
  it("focuses input after creating a new thread", async () => {
    const createConversationSpy = vi.fn().mockImplementation(async () => {
      useConversationStore.setState({ activeConversationId: "new-id", messages: [] });
      return "new-id";
    });
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    await act(async () => {
      fireEvent.click(result!.getByTestId("new-thread-btn"));
    });

    const textarea = result!.getByTestId("conversation-input");
    expect(document.activeElement).toBe(textarea);
  });

  // Cycle 24: Cmd+N from anywhere in panel
  it("Cmd+N on ConversationPanel container creates new thread", async () => {
    const createConversationSpy = vi.fn().mockImplementation(async () => {
      useConversationStore.setState({ activeConversationId: "new-id", messages: [] });
      return "new-id";
    });
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const panel = result!.getByTestId("conversation-panel");
    await act(async () => {
      fireEvent.keyDown(panel, { key: "n", metaKey: true });
    });

    expect(createConversationSpy).toHaveBeenCalledWith("page-1");
  });

  it("Ctrl+N on ConversationPanel container creates new thread", async () => {
    const createConversationSpy = vi.fn().mockImplementation(async () => {
      useConversationStore.setState({ activeConversationId: "new-id", messages: [] });
      return "new-id";
    });
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const panel = result!.getByTestId("conversation-panel");
    await act(async () => {
      fireEvent.keyDown(panel, { key: "n", ctrlKey: true });
    });

    expect(createConversationSpy).toHaveBeenCalledWith("page-1");
  });

  // Bug 2A: Guard on createConversation returning null
  it("handleSend does not call sendMessage when createConversation returns null", async () => {
    const createConversationSpy = vi.fn().mockResolvedValue(null);
    const sendMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      sendMessage: sendMessageSpy,
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const textarea = result!.getByTestId("conversation-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "my message" } });
    });
    await act(async () => {
      fireEvent.click(result!.getByTestId("conversation-send-btn"));
    });

    expect(createConversationSpy).toHaveBeenCalled();
    expect(sendMessageSpy).not.toHaveBeenCalled();
  });

  it("focuses input when panel mounts with no active conversation", async () => {
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const textarea = result!.getByTestId("conversation-input");
    expect(document.activeElement).toBe(textarea);
  });

  // Regression 1: Editor context enrichment
  it("sends textOverride with enriched prompt when editor has selection", async () => {
    const sendMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      sendMessage: sendMessageSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      detail.callback({
        selectionText: "hello world",
        selectionFrom: 0,
        selectionTo: 11,
        filePath: "test.md",
      });
    };
    window.addEventListener("lit:llm-request-context", handler);

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const textarea = result!.getByTestId("conversation-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "explain this" } });
    });
    await act(async () => {
      fireEvent.click(result!.getByTestId("conversation-send-btn"));
    });

    expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      content: "explain this",
      textOverride: "File: test.md\n\nContext:\nhello world\n\nexplain this",
    }));

    window.removeEventListener("lit:llm-request-context", handler);
  });

  it("sends no textOverride when editor has no selection", async () => {
    const sendMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      sendMessage: sendMessageSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const textarea = result!.getByTestId("conversation-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "general question" } });
    });
    await act(async () => {
      fireEvent.click(result!.getByTestId("conversation-send-btn"));
    });

    expect(sendMessageSpy).toHaveBeenCalledWith(expect.objectContaining({
      content: "general question",
      textOverride: undefined,
    }));
  });

  // Regression 2: Panel works without pageId
  it("renders without pageId and loads conversations with _global", async () => {
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({
      loadConversations: loadSpy,
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    await act(async () => {
      render(<ConversationPanel />);
    });
    expect(loadSpy).toHaveBeenCalledWith("_global");
  });

  it("reloads when pageId transitions from undefined to a real page", async () => {
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    useConversationStore.setState({
      loadConversations: loadSpy,
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    const { rerender } = render(<ConversationPanel />);
    await act(async () => {});

    expect(loadSpy).toHaveBeenCalledWith("_global");
    loadSpy.mockClear();

    await act(async () => {
      rerender(<ConversationPanel pageId="page-1" />);
    });
    expect(loadSpy).toHaveBeenCalledWith("page-1");
  });

  it("first send without pageId creates conversation with _global as node_id", async () => {
    const createConversationSpy = vi.fn().mockResolvedValue("new-conv-id");
    const sendMessageSpy = vi.fn();
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      sendMessage: sendMessageSpy,
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel />);
    });

    const textarea = result!.getByTestId("conversation-input") as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "hello" } });
    });
    await act(async () => {
      fireEvent.click(result!.getByTestId("conversation-send-btn"));
    });

    expect(createConversationSpy).toHaveBeenCalledWith("_global", "hello");
  });

  it("applies contentHeight as inline height style to the scroll container", async () => {
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" contentHeight={400} />);
    });

    const scrollContainer = result!.getByTestId("conversation-scroll-container");
    expect(scrollContainer.style.height).toBe("400px");
  });

  it("does not apply inline height when contentHeight is undefined", async () => {
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      activeConversationId: null,
      conversations: [],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel pageId="page-1" />);
    });

    const scrollContainer = result!.getByTestId("conversation-scroll-container");
    expect(scrollContainer.style.height).toBe("");
  });

  it("new thread without pageId uses _global", async () => {
    const createConversationSpy = vi.fn().mockImplementation(async () => {
      useConversationStore.setState({ activeConversationId: "new-id", messages: [] });
      return "new-id";
    });
    useConversationStore.setState({
      loadConversations: vi.fn().mockResolvedValue(undefined),
      createConversation: createConversationSpy,
      activeConversationId: "conv-1",
      conversations: [makeConversation({ id: "conv-1" })],
      messages: [],
    });

    let result: ReturnType<typeof render>;
    await act(async () => {
      result = render(<ConversationPanel />);
    });

    await act(async () => {
      fireEvent.click(result!.getByTestId("new-thread-btn"));
    });

    expect(createConversationSpy).toHaveBeenCalledWith("_global");
  });
});
