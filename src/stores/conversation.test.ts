import { describe, it, expect, beforeEach, vi } from "vitest";
import { useConversationStore } from "./conversation";

vi.mock("../lib/ipc", () => ({
  conversationList: vi.fn(),
  conversationCreate: vi.fn(),
  conversationDelete: vi.fn(),
  conversationMessages: vi.fn(),
  conversationGet: vi.fn(),
  conversationAddMessage: vi.fn(),
  conversationDeleteMessagesAfter: vi.fn(),
  llmBuildContext: vi.fn(),
  GLOBAL_NODE_ID: "_global",
}));

vi.mock("../lib/llmClient", () => ({
  startLlmStream: vi.fn(),
  cancelLlmStream: vi.fn(),
}));

import {
  conversationList,
  conversationCreate,
  conversationDelete,
  conversationMessages,
  conversationAddMessage,
  conversationDeleteMessagesAfter,
  llmBuildContext,
  GLOBAL_NODE_ID,
} from "../lib/ipc";
import type { ConversationRow, MessageRow } from "../lib/ipc";

import { startLlmStream, cancelLlmStream, type LlmStreamCallbacks } from "../lib/llmClient";
import { useLlmResponseStore } from "./llmResponse";
import { useModalLockStore } from "./modalLock";

const mockedCancelLlmStream = cancelLlmStream as ReturnType<typeof vi.fn>;

const mockedConversationList = conversationList as ReturnType<typeof vi.fn>;
const mockedConversationCreate = conversationCreate as ReturnType<typeof vi.fn>;
const mockedConversationDelete = conversationDelete as ReturnType<typeof vi.fn>;
const mockedConversationMessages = conversationMessages as ReturnType<typeof vi.fn>;
const mockedConversationAddMessage = conversationAddMessage as ReturnType<typeof vi.fn>;
const mockedStartLlmStream = startLlmStream as ReturnType<typeof vi.fn>;
const mockedConversationDeleteMessagesAfter = conversationDeleteMessagesAfter as ReturnType<typeof vi.fn>;
const mockedLlmBuildContext = llmBuildContext as ReturnType<typeof vi.fn>;

const FAKE_UUID = "00000000-0000-0000-0000-000000000001";

const fakeConversation: ConversationRow = {
  id: FAKE_UUID,
  node_id: "node-1",
  anchor_type: null,
  anchor_id: null,
  anchor_key: null,
  title: null,
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

const fakeMessage: MessageRow = {
  id: 1,
  conversation_id: FAKE_UUID,
  role: "user",
  content: "hello",
  seq: 1,
  created_at: "2025-01-01T00:00:00Z",
};

describe("conversation store", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useLlmResponseStore.getState().reset();
    useModalLockStore.setState({ llmLocked: false });
    vi.clearAllMocks();
  });

  it("initial state has null activeConversationId, empty arrays, null error", () => {
    const s = useConversationStore.getState();
    expect(s.activeConversationId).toBeNull();
    expect(s.conversations).toEqual([]);
    expect(s.messages).toEqual([]);
    expect(s.error).toBeNull();
  });

  it("loadConversations sets conversations from IPC", async () => {
    const rows: ConversationRow[] = [
      fakeConversation,
      { ...fakeConversation, id: "conv-2" },
    ];
    mockedConversationList.mockResolvedValue(rows);

    await useConversationStore.getState().loadConversations("node-1");

    expect(mockedConversationList).toHaveBeenCalledWith("node-1");
    const s = useConversationStore.getState();
    expect(s.conversations).toEqual(rows);
    expect(s.error).toBeNull();
  });

  it("loadConversations resets activeConversationId to null", async () => {
    useConversationStore.setState({
      activeConversationId: "stale-conv-from-page-a",
      messages: [fakeMessage],
      conversations: [fakeConversation],
    });
    const newRows: ConversationRow[] = [
      { ...fakeConversation, id: "conv-page-b", node_id: "node-b" },
    ];
    mockedConversationList.mockResolvedValue(newRows);

    await useConversationStore.getState().loadConversations("node-b");

    expect(useConversationStore.getState().activeConversationId).toBeNull();
  });

  it("loadConversations clears messages", async () => {
    useConversationStore.setState({
      activeConversationId: "stale-conv",
      messages: [fakeMessage, { ...fakeMessage, id: 2, seq: 2 }],
      conversations: [fakeConversation],
    });
    mockedConversationList.mockResolvedValue([]);

    await useConversationStore.getState().loadConversations("node-2");

    expect(useConversationStore.getState().messages).toEqual([]);
  });

  it("loadConversations sets error on IPC failure and preserves conversations", async () => {
    useConversationStore.setState({ conversations: [fakeConversation] });
    mockedConversationList.mockRejectedValue(new Error("db exploded"));

    await useConversationStore.getState().loadConversations("node-1");

    const s = useConversationStore.getState();
    expect(s.error).toBe("db exploded");
    expect(s.conversations).toEqual([fakeConversation]);
  });

  it("createConversation generates UUID, calls IPC, updates state, and returns id", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(FAKE_UUID as `${string}-${string}-${string}-${string}-${string}`);
    mockedConversationCreate.mockResolvedValue(fakeConversation);

    const id = await useConversationStore.getState().createConversation("node-1");

    expect(id).toBe(FAKE_UUID);
    expect(mockedConversationCreate).toHaveBeenCalledWith(FAKE_UUID, "node-1", undefined, undefined, undefined, undefined);
    const s = useConversationStore.getState();
    expect(s.activeConversationId).toBe(FAKE_UUID);
    expect(s.conversations).toEqual([fakeConversation]);
    expect(s.messages).toEqual([]);
  });

  it("createConversation sets error and returns null on IPC failure", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(FAKE_UUID as `${string}-${string}-${string}-${string}-${string}`);
    mockedConversationCreate.mockRejectedValue(new Error("insert failed"));

    const id = await useConversationStore.getState().createConversation("node-1");

    expect(id).toBeNull();
    const s = useConversationStore.getState();
    expect(s.error).toBe("insert failed");
    expect(s.conversations).toEqual([]);
    expect(s.activeConversationId).toBeNull();
  });

  it("selectConversation sets activeConversationId and loads messages", async () => {
    const msgs: MessageRow[] = [
      fakeMessage,
      { ...fakeMessage, id: 2, role: "assistant", content: "hi", seq: 2 },
    ];
    mockedConversationMessages.mockResolvedValue(msgs);

    await useConversationStore.getState().selectConversation(FAKE_UUID);

    expect(mockedConversationMessages).toHaveBeenCalledWith(FAKE_UUID);
    const s = useConversationStore.getState();
    expect(s.activeConversationId).toBe(FAKE_UUID);
    expect(s.messages).toEqual(msgs);
  });

  it("selectConversation clears stale messages before loading new ones", async () => {
    const oldMessage: MessageRow = { ...fakeMessage, content: "old" };
    useConversationStore.setState({
      activeConversationId: "old-conv",
      messages: [oldMessage],
    });

    const newMessages: MessageRow[] = [
      { ...fakeMessage, conversation_id: FAKE_UUID, content: "new" },
    ];
    mockedConversationMessages.mockResolvedValue(newMessages);

    const intermediate: MessageRow[][] = [];
    const unsub = useConversationStore.subscribe((s) => {
      intermediate.push([...s.messages]);
    });

    await useConversationStore.getState().selectConversation(FAKE_UUID);
    unsub();

    // First state update should have cleared messages (not kept old ones)
    expect(intermediate[0]).toEqual([]);
    // Final state has the new messages
    expect(useConversationStore.getState().messages).toEqual(newMessages);
  });

  it("deleteConversation removes active conversation and clears messages", async () => {
    useConversationStore.setState({
      conversations: [fakeConversation],
      activeConversationId: FAKE_UUID,
      messages: [fakeMessage],
    });
    mockedConversationDelete.mockResolvedValue(undefined);

    await useConversationStore.getState().deleteConversation(FAKE_UUID);

    expect(mockedConversationDelete).toHaveBeenCalledWith(FAKE_UUID);
    const s = useConversationStore.getState();
    expect(s.conversations).toEqual([]);
    expect(s.activeConversationId).toBeNull();
    expect(s.messages).toEqual([]);
  });

  it("createConversation passes title to IPC when provided", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(FAKE_UUID as `${string}-${string}-${string}-${string}-${string}`);
    const titledConv: ConversationRow = { ...fakeConversation, title: "My question" };
    mockedConversationCreate.mockResolvedValue(titledConv);

    await useConversationStore.getState().createConversation("node-1", "My question");

    expect(mockedConversationCreate).toHaveBeenCalledWith(FAKE_UUID, "node-1", undefined, undefined, undefined, "My question");
    expect(useConversationStore.getState().conversations[0]?.title).toBe("My question");
  });

  // --- Group B: sendMessage ---

  it("sendMessage sets error when no active conversation", async () => {
    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    const s = useConversationStore.getState();
    expect(s.error).toBe("No active conversation");
    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
  });

  it("sendMessage silently returns when already streaming", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    useLlmResponseStore.getState().startStream({ question: "prior" });

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useConversationStore.getState().error).toBeNull();
  });

  it("sendMessage persists user message via IPC and appends to messages", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    expect(mockedConversationAddMessage).toHaveBeenCalledWith(
      FAKE_UUID,
      "user",
      "hello",
    );
    expect(useConversationStore.getState().messages).toContainEqual(persistedMsg);
  });

  it("sendMessage builds messages array and calls startLlmStream with correct args", async () => {
    const priorMessages: MessageRow[] = [
      { id: 1, conversation_id: FAKE_UUID, role: "user", content: "first q", seq: 1, created_at: "2025-01-01T00:00:00Z" },
      { id: 2, conversation_id: FAKE_UUID, role: "assistant", content: "first a", seq: 2, created_at: "2025-01-01T00:00:01Z" },
    ];
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: priorMessages,
    });

    const newUserMsg: MessageRow = {
      id: 3,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "new q",
      seq: 3,
      created_at: "2025-01-01T00:00:02Z",
    };
    mockedConversationAddMessage.mockResolvedValue(newUserMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "new q",
      model: "test-model",
      system: "be helpful",
    });

    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      {
        model: "test-model",
        text: "new q",
        system: "be helpful",
        messages: [
          { role: "user", content: "first q" },
          { role: "assistant", content: "first a" },
          { role: "user", content: "new q" },
        ],
      },
      expect.any(Object),
    );
  });

  it("sendMessage sets streaming state and lock before calling startLlmStream", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);

    let statusAtCallTime: string | undefined;
    let llmLockedAtCallTime: boolean | undefined;
    let startStreamQuestion: string | undefined;
    mockedStartLlmStream.mockImplementation(async () => {
      statusAtCallTime = useLlmResponseStore.getState().status;
      llmLockedAtCallTime = useModalLockStore.getState().llmLocked;
      startStreamQuestion = useLlmResponseStore.getState().question;
    });

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    expect(statusAtCallTime).toBe("streaming");
    expect(llmLockedAtCallTime).toBe(true);
    expect(startStreamQuestion).toBe("hello");
  });

  // --- Stage 3: Streaming Callbacks (cycles 13–15) ---

  it("sendMessage onChunk appends to llmResponse", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    capturedCallbacks!.onChunk("hello");
    expect(useLlmResponseStore.getState().responseText).toBe("hello");
  });

  it("sendMessage onDone persists assistant message and unlocks", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedUserMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    const persistedAssistantMsg: MessageRow = {
      id: 11,
      conversation_id: FAKE_UUID,
      role: "assistant",
      content: "the response",
      seq: 2,
      created_at: "2025-01-01T00:00:02Z",
    };

    let callCount = 0;
    mockedConversationAddMessage.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return persistedUserMsg;
      return persistedAssistantMsg;
    });

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    // Simulate chunks arriving, building up responseText
    useLlmResponseStore.setState({ responseText: "the response" });

    // Invoke onDone
    await capturedCallbacks!.onDone();

    // Assert assistant message persisted
    expect(mockedConversationAddMessage).toHaveBeenCalledWith(
      FAKE_UUID,
      "assistant",
      "the response",
    );
    // Assert assistant message appended to store
    expect(useConversationStore.getState().messages).toContainEqual(persistedAssistantMsg);
    // Assert stream finished
    expect(useLlmResponseStore.getState().status).toBe("done");
    // Assert modal unlocked
    expect(useModalLockStore.getState().llmLocked).toBe(false);
  });

  it("sendMessage onError sets error on llmResponse and unlocks", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    capturedCallbacks!.onError({ message: "rate limited", retryable: true });

    // Assert llmResponse store shows error
    expect(useLlmResponseStore.getState().status).toBe("error");
    expect(useLlmResponseStore.getState().errorMessage).toBe("rate limited");
    // Assert modal unlocked
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    // Assert conversationAddMessage was NOT called a second time (no assistant persist)
    expect(mockedConversationAddMessage).toHaveBeenCalledTimes(1);
    // User message should remain in messages
    expect(useConversationStore.getState().messages).toEqual([persistedMsg]);
  });

  it("sendMessage sets error and skips stream when user message persist fails", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    mockedConversationAddMessage.mockRejectedValue(new Error("disk full"));

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    // Assert error set on conversation store
    expect(useConversationStore.getState().error).toBe("disk full");
    // Assert startLlmStream was NOT called
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    // Assert llmLocked was never set to true
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    // Assert llmResponse status is still idle
    expect(useLlmResponseStore.getState().status).toBe("idle");
  });

  it("sendMessage with textOverride persists raw content to DB but passes textOverride to LLM", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "explain this",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "explain this",
      textOverride: "File: test.md\n\nContext:\nhello world\n\nexplain this",
      model: "test-model",
    });

    expect(mockedConversationAddMessage).toHaveBeenCalledWith(
      FAKE_UUID,
      "user",
      "explain this",
    );
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "File: test.md\n\nContext:\nhello world\n\nexplain this",
      }),
      expect.any(Object),
    );
  });

  it("sendMessage without textOverride passes content for both DB and LLM", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "plain question",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "plain question",
      model: "test-model",
    });

    expect(mockedConversationAddMessage).toHaveBeenCalledWith(
      FAKE_UUID,
      "user",
      "plain question",
    );
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "plain question",
      }),
      expect.any(Object),
    );
  });

  // --- Group C: cancelConversationStream (cycle 17) ---

  it("cancelConversationStream stops stream, unlocks, and cancels LLM without persisting", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });
    mockedCancelLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    // Simulate a chunk arriving
    capturedCallbacks!.onChunk("partial ");

    // Act
    await useConversationStore.getState().cancelConversationStream();

    // Assert stream stopped
    expect(useLlmResponseStore.getState().status).toBe("done");
    // Assert modal unlocked
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    // Assert cancel IPC called
    expect(mockedCancelLlmStream).toHaveBeenCalled();
    // Assert no assistant message persisted (only the user message)
    expect(mockedConversationAddMessage).toHaveBeenCalledTimes(1);
  });

  it("deleteConversation on non-active preserves activeConversationId and messages", async () => {
    const otherConv: ConversationRow = { ...fakeConversation, id: "conv-other" };
    useConversationStore.setState({
      conversations: [fakeConversation, otherConv],
      activeConversationId: FAKE_UUID,
      messages: [fakeMessage],
    });
    mockedConversationDelete.mockResolvedValue(undefined);

    await useConversationStore.getState().deleteConversation("conv-other");

    expect(mockedConversationDelete).toHaveBeenCalledWith("conv-other");
    const s = useConversationStore.getState();
    expect(s.conversations).toEqual([fakeConversation]);
    expect(s.activeConversationId).toBe(FAKE_UUID);
    expect(s.messages).toEqual([fakeMessage]);
  });

  // --- Group E: retryLastMessage ---

  it("retryLastMessage returns early with no active conversation", async () => {
    await useConversationStore.getState().retryLastMessage({ model: "m" });

    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useConversationStore.getState().error).toBeNull();
  });

  it("retryLastMessage returns early when last message is not assistant", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg],
    });

    await useConversationStore.getState().retryLastMessage({ model: "m" });

    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
  });

  it("retryLastMessage returns early when already streaming", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "hi", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    useLlmResponseStore.getState().startStream({ question: "prior" });

    await useConversationStore.getState().retryLastMessage({ model: "m" });

    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
  });

  it("retryLastMessage deletes assistant msg, truncates, and re-streams", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "hi", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);

    const persistedAssistant: MessageRow = {
      id: 3, conversation_id: FAKE_UUID, role: "assistant",
      content: "new response", seq: 2, created_at: "2025-01-01T00:00:02Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedAssistant);

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });

    await useConversationStore.getState().retryLastMessage({ model: "m" });

    // Assert delete called with last user msg's seq
    expect(mockedConversationDeleteMessagesAfter).toHaveBeenCalledWith(FAKE_UUID, 1);
    // Assert local messages truncated to only user msg
    expect(useConversationStore.getState().messages).toEqual([userMsg]);
    // Assert startLlmStream called with the user message
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      {
        model: "m",
        text: "hello",
        system: undefined,
        messages: [{ role: "user", content: "hello" }],
      },
      expect.any(Object),
    );
    // Assert streaming state
    expect(useLlmResponseStore.getState().status).toBe("streaming");
    expect(useModalLockStore.getState().llmLocked).toBe(true);

    // Complete the stream
    useLlmResponseStore.setState({ responseText: "new response" });
    await capturedCallbacks!.onDone();

    expect(useConversationStore.getState().messages).toEqual([userMsg, persistedAssistant]);
    expect(useLlmResponseStore.getState().status).toBe("done");
    expect(useModalLockStore.getState().llmLocked).toBe(false);
  });

  it("retryLastMessage with multi-turn history preserves earlier messages", async () => {
    const u1: MessageRow = { id: 1, conversation_id: FAKE_UUID, role: "user", content: "q1", seq: 1, created_at: "2025-01-01T00:00:00Z" };
    const a2: MessageRow = { id: 2, conversation_id: FAKE_UUID, role: "assistant", content: "a1", seq: 2, created_at: "2025-01-01T00:00:01Z" };
    const u3: MessageRow = { id: 3, conversation_id: FAKE_UUID, role: "user", content: "q2", seq: 3, created_at: "2025-01-01T00:00:02Z" };
    const a4: MessageRow = { id: 4, conversation_id: FAKE_UUID, role: "assistant", content: "a2", seq: 4, created_at: "2025-01-01T00:00:03Z" };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [u1, a2, u3, a4],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().retryLastMessage({ model: "m" });

    // Only a4 deleted — messages after call = [u1, a2, u3]
    expect(mockedConversationDeleteMessagesAfter).toHaveBeenCalledWith(FAKE_UUID, 3);
    expect(useConversationStore.getState().messages).toEqual([u1, a2, u3]);
    // startLlmStream receives all 3 messages
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      {
        model: "m",
        text: "q2",
        system: undefined,
        messages: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1" },
          { role: "user", content: "q2" },
        ],
      },
      expect.any(Object),
    );
  });

  // --- Group F: editMessage ---

  it("editMessage returns early with no active conversation", async () => {
    await useConversationStore.getState().editMessage(1, "new", { model: "m" });

    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useConversationStore.getState().error).toBeNull();
  });

  it("editMessage returns early when already streaming", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID, messages: [fakeMessage] });
    useLlmResponseStore.getState().startStream({ question: "prior" });

    await useConversationStore.getState().editMessage(1, "new", { model: "m" });

    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
  });

  it("editMessage deletes from seq, persists edited message, and re-streams", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "hi", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);

    const editedUserMsg: MessageRow = {
      id: 3, conversation_id: FAKE_UUID, role: "user",
      content: "new content", seq: 1, created_at: "2025-01-01T00:00:02Z",
    };
    const persistedAssistant: MessageRow = {
      id: 4, conversation_id: FAKE_UUID, role: "assistant",
      content: "new response", seq: 2, created_at: "2025-01-01T00:00:03Z",
    };

    let addMessageCallCount = 0;
    mockedConversationAddMessage.mockImplementation(async () => {
      addMessageCallCount++;
      if (addMessageCallCount === 1) return editedUserMsg;
      return persistedAssistant;
    });

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });

    await useConversationStore.getState().editMessage(1, "new content", { model: "m" });

    // Assert delete called with seq - 1 = 0
    expect(mockedConversationDeleteMessagesAfter).toHaveBeenCalledWith(FAKE_UUID, 0);
    // Assert edited user message persisted
    expect(mockedConversationAddMessage).toHaveBeenCalledWith(FAKE_UUID, "user", "new content");
    // Assert local messages = [editedUserMsg]
    expect(useConversationStore.getState().messages).toEqual([editedUserMsg]);
    // Assert startLlmStream called with edited content
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      {
        model: "m",
        text: "new content",
        system: undefined,
        messages: [{ role: "user", content: "new content" }],
      },
      expect.any(Object),
    );

    // Complete the stream
    useLlmResponseStore.setState({ responseText: "new response" });
    await capturedCallbacks!.onDone();

    expect(useConversationStore.getState().messages).toEqual([editedUserMsg, persistedAssistant]);
  });

  // --- Group G: Edge cases ---

  it("reset clears all state back to initial values", () => {
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [fakeMessage],
      conversations: [fakeConversation],
      error: "some error",
    });

    useConversationStore.getState().reset();

    const s = useConversationStore.getState();
    expect(s.activeConversationId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.conversations).toEqual([]);
    expect(s.error).toBeNull();
  });

  it("onDone sets error on conversation store when assistant persist fails", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedUserMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };

    let addMessageCallCount = 0;
    mockedConversationAddMessage.mockImplementation(async () => {
      addMessageCallCount++;
      if (addMessageCallCount === 1) return persistedUserMsg;
      throw new Error("persist failed");
    });

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    useLlmResponseStore.setState({ responseText: "the response" });
    await capturedCallbacks!.onDone();

    expect(useLlmResponseStore.getState().status).toBe("done");
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useConversationStore.getState().error).toBe("persist failed");
    expect(useConversationStore.getState().messages).toEqual([persistedUserMsg]);
  });

  // --- Group H: _streamAndPersist error recovery ---

  it("sendMessage unlocks and sets error when startLlmStream rejects", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockRejectedValue(new Error("ipc exploded"));

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useLlmResponseStore.getState().status).toBe("error");
    expect(useLlmResponseStore.getState().errorMessage).toBe("ipc exploded");
    expect(useConversationStore.getState().error).toBe("ipc exploded");
  });

  it("retryLastMessage unlocks and sets error when startLlmStream rejects", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "hi", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);
    mockedStartLlmStream.mockRejectedValue(new Error("ipc exploded"));

    await useConversationStore.getState().retryLastMessage({ model: "m" });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useLlmResponseStore.getState().status).toBe("error");
    expect(useLlmResponseStore.getState().errorMessage).toBe("ipc exploded");
    expect(useConversationStore.getState().error).toBe("ipc exploded");
    // Messages stay truncated (delete already happened)
    expect(useConversationStore.getState().messages).toEqual([userMsg]);
  });

  it("editMessage unlocks and sets error when startLlmStream rejects", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "hi", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);

    const editedUserMsg: MessageRow = {
      id: 3, conversation_id: FAKE_UUID, role: "user",
      content: "new content", seq: 1, created_at: "2025-01-01T00:00:02Z",
    };
    mockedConversationAddMessage.mockResolvedValue(editedUserMsg);
    mockedStartLlmStream.mockRejectedValue(new Error("ipc exploded"));

    await useConversationStore.getState().editMessage(1, "new content", { model: "m" });

    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useLlmResponseStore.getState().status).toBe("error");
    expect(useLlmResponseStore.getState().errorMessage).toBe("ipc exploded");
    expect(useConversationStore.getState().error).toBe("ipc exploded");
    // Edited user message is still in store
    expect(useConversationStore.getState().messages).toEqual([editedUserMsg]);
  });

  // --- Group I: editMessage addMessage error handling ---

  it("editMessage sets error and skips stream when addMessage fails after delete", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "hi", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);
    mockedConversationAddMessage.mockRejectedValue(new Error("disk full"));

    await useConversationStore.getState().editMessage(1, "new content", { model: "m" });

    expect(useConversationStore.getState().error).toBe("disk full");
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useModalLockStore.getState().llmLocked).toBe(false);
    expect(useLlmResponseStore.getState().status).toBe("idle");
    // Messages are the post-delete set (truncated but no new user msg)
    expect(useConversationStore.getState().messages).toEqual([]);
  });

  it("onDone after cancel does not persist assistant message", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedUserMsg: MessageRow = {
      id: 10,
      conversation_id: FAKE_UUID,
      role: "user",
      content: "hello",
      seq: 1,
      created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedUserMsg);

    let capturedCallbacks: LlmStreamCallbacks | null = null;
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacks = cbs;
    });
    mockedCancelLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    // Cancel the stream
    await useConversationStore.getState().cancelConversationStream();

    // Simulate the backend emitting onDone after cancel (race condition)
    useLlmResponseStore.setState({ responseText: "partial\n\n**[Stopped]**" });
    await capturedCallbacks!.onDone();

    // Assert no assistant message was persisted (only the user message)
    expect(mockedConversationAddMessage).toHaveBeenCalledTimes(1);
    expect(useConversationStore.getState().messages).toEqual([persistedUserMsg]);
  });

  it("selectConversation sets error when IPC fails", async () => {
    mockedConversationMessages.mockRejectedValue(new Error("db read failed"));

    await useConversationStore.getState().selectConversation(FAKE_UUID);

    const s = useConversationStore.getState();
    expect(s.error).toBe("db read failed");
    expect(s.messages).toEqual([]);
    expect(s.activeConversationId).toBe(FAKE_UUID);
  });

  it("deleteConversation sets error and preserves state when IPC fails", async () => {
    useConversationStore.setState({
      conversations: [fakeConversation],
      activeConversationId: FAKE_UUID,
      messages: [fakeMessage],
    });
    mockedConversationDelete.mockRejectedValue(new Error("db locked"));

    await useConversationStore.getState().deleteConversation(FAKE_UUID);

    const s = useConversationStore.getState();
    expect(s.error).toBe("db locked");
    expect(s.conversations).toEqual([fakeConversation]);
    expect(s.activeConversationId).toBe(FAKE_UUID);
    expect(s.messages).toEqual([fakeMessage]);
  });

  // --- Group J: Stream cancellation race conditions ---

  it("race: onDone from cancelled stream does not persist when a new stream has started", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const userMsgA: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "question A", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    const userMsgB: MessageRow = {
      id: 11, conversation_id: FAKE_UUID, role: "user",
      content: "question B", seq: 2, created_at: "2025-01-01T00:00:02Z",
    };

    let addMessageCallCount = 0;
    mockedConversationAddMessage.mockImplementation(async () => {
      addMessageCallCount++;
      if (addMessageCallCount === 1) return userMsgA;
      return userMsgB;
    });

    const capturedCallbacksList: LlmStreamCallbacks[] = [];
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacksList.push(cbs);
    });
    mockedCancelLlmStream.mockResolvedValue(undefined);

    // Start stream A
    await useConversationStore.getState().sendMessage({ content: "question A", model: "m" });
    const callbacksA = capturedCallbacksList[0]!;

    // Cancel stream A
    await useConversationStore.getState().cancelConversationStream();

    // Start stream B
    await useConversationStore.getState().sendMessage({ content: "question B", model: "m" });

    // Stale onDone from stream A fires
    useLlmResponseStore.setState({ responseText: "stale response A" });
    await callbacksA.onDone();

    // Should NOT have persisted stale assistant message — only 2 user messages
    expect(mockedConversationAddMessage).toHaveBeenCalledTimes(2);
  });

  it("race: onError from cancelled stream does not corrupt active stream", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const userMsgA: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "question A", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    const userMsgB: MessageRow = {
      id: 11, conversation_id: FAKE_UUID, role: "user",
      content: "question B", seq: 2, created_at: "2025-01-01T00:00:02Z",
    };

    let addMessageCallCount = 0;
    mockedConversationAddMessage.mockImplementation(async () => {
      addMessageCallCount++;
      if (addMessageCallCount === 1) return userMsgA;
      return userMsgB;
    });

    const capturedCallbacksList: LlmStreamCallbacks[] = [];
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacksList.push(cbs);
    });
    mockedCancelLlmStream.mockResolvedValue(undefined);

    // Start stream A
    await useConversationStore.getState().sendMessage({ content: "question A", model: "m" });
    const callbacksA = capturedCallbacksList[0]!;

    // Cancel stream A
    await useConversationStore.getState().cancelConversationStream();

    // Start stream B
    await useConversationStore.getState().sendMessage({ content: "question B", model: "m" });

    // Stale onError from stream A fires
    callbacksA.onError({ message: "stale error", retryable: false });

    // Stream B should still be active — not corrupted by stale error
    expect(useLlmResponseStore.getState().status).toBe("streaming");
    expect(useModalLockStore.getState().llmLocked).toBe(true);
    expect(useLlmResponseStore.getState().errorMessage).not.toBe("stale error");
  });

  it("race: onChunk from cancelled stream does not corrupt active stream response", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const userMsgA: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "question A", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    const userMsgB: MessageRow = {
      id: 11, conversation_id: FAKE_UUID, role: "user",
      content: "question B", seq: 2, created_at: "2025-01-01T00:00:02Z",
    };

    let addMessageCallCount = 0;
    mockedConversationAddMessage.mockImplementation(async () => {
      addMessageCallCount++;
      if (addMessageCallCount === 1) return userMsgA;
      return userMsgB;
    });

    const capturedCallbacksList: LlmStreamCallbacks[] = [];
    mockedStartLlmStream.mockImplementation(async (_args: unknown, cbs: LlmStreamCallbacks) => {
      capturedCallbacksList.push(cbs);
    });
    mockedCancelLlmStream.mockResolvedValue(undefined);

    // Start stream A
    await useConversationStore.getState().sendMessage({ content: "question A", model: "m" });
    const callbacksA = capturedCallbacksList[0]!;

    // Cancel stream A
    await useConversationStore.getState().cancelConversationStream();

    // Start stream B
    await useConversationStore.getState().sendMessage({ content: "question B", model: "m" });
    const callbacksB = capturedCallbacksList[1]!;

    // Stream B sends a chunk
    callbacksB.onChunk("chunk-B");

    // Stale chunk from stream A arrives
    callbacksA.onChunk("stale-chunk-A");

    // responseText should only contain stream B's chunk
    expect(useLlmResponseStore.getState().responseText).toBe("chunk-B");
  });

  it("editMessage on middle message preserves earlier history", async () => {
    const u1: MessageRow = { id: 1, conversation_id: FAKE_UUID, role: "user", content: "q1", seq: 1, created_at: "2025-01-01T00:00:00Z" };
    const a2: MessageRow = { id: 2, conversation_id: FAKE_UUID, role: "assistant", content: "a1", seq: 2, created_at: "2025-01-01T00:00:01Z" };
    const u3: MessageRow = { id: 3, conversation_id: FAKE_UUID, role: "user", content: "q2", seq: 3, created_at: "2025-01-01T00:00:02Z" };
    const a4: MessageRow = { id: 4, conversation_id: FAKE_UUID, role: "assistant", content: "a2", seq: 4, created_at: "2025-01-01T00:00:03Z" };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [u1, a2, u3, a4],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);

    const editedU3: MessageRow = {
      id: 5, conversation_id: FAKE_UUID, role: "user",
      content: "edited q", seq: 3, created_at: "2025-01-01T00:00:04Z",
    };
    mockedConversationAddMessage.mockResolvedValue(editedU3);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().editMessage(3, "edited q", { model: "m" });

    // Assert delete called with seq - 1 = 2
    expect(mockedConversationDeleteMessagesAfter).toHaveBeenCalledWith(FAKE_UUID, 2);
    // Assert local messages = [u1, a2, editedU3]
    expect(useConversationStore.getState().messages).toEqual([u1, a2, editedU3]);
    // Assert startLlmStream receives full history
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      {
        model: "m",
        text: "edited q",
        system: undefined,
        messages: [
          { role: "user", content: "q1" },
          { role: "assistant", content: "a1" },
          { role: "user", content: "edited q" },
        ],
      },
      expect.any(Object),
    );
  });

  // --- Group K: llmBuildContext integration ---

  it("sendMessage calls llmBuildContext with correct args when nodeId and neighborsDepth are provided", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedLlmBuildContext.mockResolvedValue({
      system: "built system",
      messages: [{ role: "user", content: "hello" }],
      truncation: null,
    });
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
      system: "raw system",
      nodeId: "page-42",
      neighborsDepth: 2,
    });

    expect(mockedLlmBuildContext).toHaveBeenCalledWith({
      nodeId: "page-42",
      systemPrompt: "raw system",
      neighborsDepth: 2,
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("sendMessage passes built context to startLlmStream when llmBuildContext succeeds", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedLlmBuildContext.mockResolvedValue({
      system: "enriched system with doc context",
      messages: [{ role: "user", content: "trimmed hello" }],
      truncation: { original_tokens: 100, kept_tokens: 80 },
    });
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
      system: "raw system",
      nodeId: "page-42",
      neighborsDepth: 2,
    });

    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      {
        model: "test-model",
        text: "hello",
        system: "enriched system with doc context",
        messages: [{ role: "user", content: "trimmed hello" }],
      },
      expect.any(Object),
    );
  });

  it("sendMessage falls back to raw args when llmBuildContext rejects", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedLlmBuildContext.mockRejectedValue(new Error("graph unavailable"));
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
      system: "raw system",
      nodeId: "page-42",
      neighborsDepth: 2,
    });

    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      {
        model: "test-model",
        text: "hello",
        system: "raw system",
        messages: [{ role: "user", content: "hello" }],
      },
      expect.any(Object),
    );
    expect(useConversationStore.getState().error).toBeNull();
  });

  it("sendMessage logs warning when llmBuildContext rejects", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    const testError = new Error("graph unavailable");
    mockedLlmBuildContext.mockRejectedValue(testError);
    mockedStartLlmStream.mockResolvedValue(undefined);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
      nodeId: "page-42",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "llmBuildContext failed, using raw context:",
      testError,
    );
    warnSpy.mockRestore();
  });

  it("sendMessage defaults nodeId to _global and neighborsDepth to 1 when omitted", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedLlmBuildContext.mockResolvedValue({
      system: "built",
      messages: [{ role: "user", content: "hello" }],
      truncation: null,
    });
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    expect(mockedLlmBuildContext).toHaveBeenCalledWith({
      nodeId: GLOBAL_NODE_ID,
      systemPrompt: undefined,
      neighborsDepth: 1,
      model: "test-model",
      messages: [{ role: "user", content: "hello" }],
    });
  });
});
