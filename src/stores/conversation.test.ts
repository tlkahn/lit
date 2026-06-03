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
  conversationFindByAnchor: vi.fn(),
  conversationDeleteByAnchor: vi.fn(),
  conversationUpdateTitle: vi.fn(),
  llmBuildContext: vi.fn(),
  secretStoreStatus: vi.fn(),
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
  conversationFindByAnchor,
  conversationDeleteByAnchor,
  conversationUpdateTitle,
  llmBuildContext,
  secretStoreStatus,
  GLOBAL_NODE_ID,
} from "../lib/ipc";
import type { ConversationRow, MessageRow, Annotation } from "../lib/ipc";

import { startLlmStream, cancelLlmStream, type LlmStreamCallbacks } from "../lib/llmClient";
import { useLlmResponseStore } from "./llmResponse";
import { useModalLockStore } from "./modalLock";
import { usePreferencesStore } from "./preferences";
import { useSecretStoreStore } from "./secretStore";

const mockedCancelLlmStream = cancelLlmStream as ReturnType<typeof vi.fn>;

const mockedConversationList = conversationList as ReturnType<typeof vi.fn>;
const mockedConversationCreate = conversationCreate as ReturnType<typeof vi.fn>;
const mockedConversationDelete = conversationDelete as ReturnType<typeof vi.fn>;
const mockedConversationMessages = conversationMessages as ReturnType<typeof vi.fn>;
const mockedConversationAddMessage = conversationAddMessage as ReturnType<typeof vi.fn>;
const mockedStartLlmStream = startLlmStream as ReturnType<typeof vi.fn>;
const mockedConversationDeleteMessagesAfter = conversationDeleteMessagesAfter as ReturnType<typeof vi.fn>;
const mockedConversationFindByAnchor = conversationFindByAnchor as ReturnType<typeof vi.fn>;
const mockedConversationDeleteByAnchor = conversationDeleteByAnchor as ReturnType<typeof vi.fn>;
const mockedConversationUpdateTitle = conversationUpdateTitle as ReturnType<typeof vi.fn>;
const mockedLlmBuildContext = llmBuildContext as ReturnType<typeof vi.fn>;
const mockedSecretStoreStatus = secretStoreStatus as ReturnType<typeof vi.fn>;

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

const fakeAnnotation: Annotation = {
  form: "compact",
  annotation_type: "note",
  certainty: "firm",
  scope: { kind: "words", value: 3 },
  body: "annotation body",
  date: null,
  is_structured: false,
  char_start: 0,
  char_end: 10,
  original: "[n::test]",
  uuid: null,
};

describe("conversation store", () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
    useLlmResponseStore.getState().reset();
    useModalLockStore.setState({ llmLocked: false });
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: false });
    useSecretStoreStore.setState({ exists: true, unlocked: true, loading: false, promptOpen: false });
    useSecretStoreStore.getState()._resetSettler();
    vi.clearAllMocks();
    mockedConversationUpdateTitle.mockResolvedValue(undefined);
    mockedSecretStoreStatus.mockResolvedValue({ exists: true, unlocked: false });
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

  it("retryLastMessage with textOverride sends enriched text to LLM but keeps DB content unchanged", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "explain this", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "sure", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().retryLastMessage({
      model: "m",
      textOverride: "File: test.md\n\nContext:\nhello world\n\nexplain this",
    });

    expect(useConversationStore.getState().messages).toEqual([userMsg]);
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "File: test.md\n\nContext:\nhello world\n\nexplain this",
      }),
      expect.any(Object),
    );
  });

  it("retryLastMessage without textOverride uses raw stored content", async () => {
    const userMsg: MessageRow = {
      id: 1, conversation_id: FAKE_UUID, role: "user",
      content: "plain question", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    const assistantMsg: MessageRow = {
      id: 2, conversation_id: FAKE_UUID, role: "assistant",
      content: "answer", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    useConversationStore.setState({
      activeConversationId: FAKE_UUID,
      messages: [userMsg, assistantMsg],
    });
    mockedConversationDeleteMessagesAfter.mockResolvedValue(undefined);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().retryLastMessage({ model: "m" });

    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({ text: "plain question" }),
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

  it("editMessage with textOverride persists raw content to DB but sends enriched text to LLM", async () => {
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
      content: "explain this", seq: 1, created_at: "2025-01-01T00:00:02Z",
    };
    mockedConversationAddMessage.mockResolvedValue(editedUserMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().editMessage(1, "explain this", {
      model: "m",
      textOverride: "File: test.md\n\nContext:\nselected text\n\nexplain this",
    });

    expect(mockedConversationAddMessage).toHaveBeenCalledWith(
      FAKE_UUID,
      "user",
      "explain this",
    );
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "File: test.md\n\nContext:\nselected text\n\nexplain this",
      }),
      expect.any(Object),
    );
  });

  it("editMessage without textOverride passes raw content for both DB and LLM", async () => {
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
      content: "plain edit", seq: 1, created_at: "2025-01-01T00:00:02Z",
    };
    mockedConversationAddMessage.mockResolvedValue(editedUserMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().editMessage(1, "plain edit", { model: "m" });

    expect(mockedConversationAddMessage).toHaveBeenCalledWith(
      FAKE_UUID,
      "user",
      "plain edit",
    );
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({ text: "plain edit" }),
      expect.any(Object),
    );
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

  // --- Group L: createConversation with anchor args (Cycle 4.1) ---

  it("createConversation passes anchorType and anchorKey to IPC", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(FAKE_UUID as `${string}-${string}-${string}-${string}-${string}`);
    const anchoredConv: ConversationRow = {
      ...fakeConversation,
      anchor_type: "annotation",
      anchor_key: "uuid-abc",
      title: "My thread",
    };
    mockedConversationCreate.mockResolvedValue(anchoredConv);

    await useConversationStore.getState().createConversation("node-1", "My thread", "annotation", "uuid-abc");

    expect(mockedConversationCreate).toHaveBeenCalledWith(FAKE_UUID, "node-1", "annotation", undefined, "uuid-abc", "My thread");
  });

  // --- Group M: findOrCreateAnnotationThread (Cycle 4.2) ---

  it("findOrCreateAnnotationThread creates new thread when none exists", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(FAKE_UUID as `${string}-${string}-${string}-${string}-${string}`);
    mockedConversationFindByAnchor.mockResolvedValue(null);
    mockedConversationCreate.mockResolvedValue({
      ...fakeConversation,
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    });

    const id = await useConversationStore.getState().findOrCreateAnnotationThread("node-1", "ann-uuid-1", "My thread");

    expect(id).toBe(FAKE_UUID);
    expect(mockedConversationFindByAnchor).toHaveBeenCalledWith("node-1", "annotation", "ann-uuid-1");
    expect(mockedConversationCreate).toHaveBeenCalledWith(FAKE_UUID, "node-1", "annotation", undefined, "ann-uuid-1", "My thread");
  });

  it("findOrCreateAnnotationThread reuses existing thread and loads messages", async () => {
    const existingConv: ConversationRow = {
      ...fakeConversation,
      id: "existing-conv-id",
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    };
    const msgs: MessageRow[] = [fakeMessage];
    mockedConversationFindByAnchor.mockResolvedValue(existingConv);
    mockedConversationMessages.mockResolvedValue(msgs);

    const id = await useConversationStore.getState().findOrCreateAnnotationThread("node-1", "ann-uuid-1");

    expect(id).toBe("existing-conv-id");
    expect(mockedConversationMessages).toHaveBeenCalledWith("existing-conv-id");
    expect(mockedConversationCreate).not.toHaveBeenCalled();
    expect(useConversationStore.getState().messages).toEqual(msgs);
  });

  it("findOrCreateAnnotationThread returns null when create fails", async () => {
    mockedConversationFindByAnchor.mockResolvedValue(null);
    mockedConversationCreate.mockRejectedValue(new Error("create failed"));

    const id = await useConversationStore.getState().findOrCreateAnnotationThread("node-1", "ann-uuid-1");

    expect(id).toBeNull();
    expect(useConversationStore.getState().error).toBe("create failed");
  });

  it("findOrCreateAnnotationThread returns null when find fails", async () => {
    mockedConversationFindByAnchor.mockRejectedValue(new Error("db error"));

    const id = await useConversationStore.getState().findOrCreateAnnotationThread("node-1", "ann-uuid-1");

    expect(id).toBeNull();
    expect(useConversationStore.getState().error).toBe("db error");
  });

  // --- Group N: fireSourceAnnotation threading (Cycle 4.3a) ---

  it("sendMessage passes fireSourceAnnotation to llmResponse startStream", async () => {
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);

    let capturedAnnotation: Annotation | null | undefined;
    mockedStartLlmStream.mockImplementation(async () => {
      capturedAnnotation = useLlmResponseStore.getState().fireSourceAnnotation;
    });

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
      fireSourceAnnotation: fakeAnnotation,
    });

    expect(capturedAnnotation).toBe(fakeAnnotation);
  });

  // --- Group O: sendAnnotationFire (Cycle 4.3b) ---

  it("sendAnnotationFire creates thread and sends message with fireSourceAnnotation", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(FAKE_UUID as `${string}-${string}-${string}-${string}-${string}`);
    mockedConversationFindByAnchor.mockResolvedValue(null);
    mockedConversationCreate.mockResolvedValue({
      ...fakeConversation,
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "fire content", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);

    let capturedAnnotation: Annotation | null | undefined;
    mockedStartLlmStream.mockImplementation(async () => {
      capturedAnnotation = useLlmResponseStore.getState().fireSourceAnnotation;
    });

    await useConversationStore.getState().sendAnnotationFire({
      nodeId: "node-1",
      annotationUuid: "ann-uuid-1",
      annotation: fakeAnnotation,
      content: "fire content",
      model: "test-model",
    });

    expect(mockedConversationCreate).toHaveBeenCalled();
    expect(mockedConversationAddMessage).toHaveBeenCalledWith(FAKE_UUID, "user", "fire content");
    expect(mockedStartLlmStream).toHaveBeenCalled();
    expect(capturedAnnotation).toBe(fakeAnnotation);
  });

  it("sendAnnotationFire reuses existing thread and appends message", async () => {
    const existingConv: ConversationRow = {
      ...fakeConversation,
      id: "existing-conv-id",
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    };
    const priorMsg: MessageRow = {
      id: 1, conversation_id: "existing-conv-id", role: "user",
      content: "prior", seq: 1, created_at: "2025-01-01T00:00:00Z",
    };
    mockedConversationFindByAnchor.mockResolvedValue(existingConv);
    mockedConversationMessages.mockResolvedValue([priorMsg]);

    const newUserMsg: MessageRow = {
      id: 2, conversation_id: "existing-conv-id", role: "user",
      content: "fire content", seq: 2, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(newUserMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendAnnotationFire({
      nodeId: "node-1",
      annotationUuid: "ann-uuid-1",
      annotation: fakeAnnotation,
      content: "fire content",
      model: "test-model",
    });

    expect(mockedConversationCreate).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: "user", content: "prior" },
          { role: "user", content: "fire content" },
        ],
      }),
      expect.any(Object),
    );
  });

  it("sendAnnotationFire passes textOverride to LLM but persists raw content", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(FAKE_UUID as `${string}-${string}-${string}-${string}-${string}`);
    mockedConversationFindByAnchor.mockResolvedValue(null);
    mockedConversationCreate.mockResolvedValue(fakeConversation);
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "raw content", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendAnnotationFire({
      nodeId: "node-1",
      annotationUuid: "ann-uuid-1",
      annotation: fakeAnnotation,
      content: "raw content",
      textOverride: "enriched content with context",
      model: "test-model",
    });

    expect(mockedConversationAddMessage).toHaveBeenCalledWith(FAKE_UUID, "user", "raw content");
    expect(mockedStartLlmStream).toHaveBeenCalledWith(
      expect.objectContaining({ text: "enriched content with context" }),
      expect.any(Object),
    );
  });

  it("sendAnnotationFire returns early when findOrCreate fails", async () => {
    mockedConversationFindByAnchor.mockRejectedValue(new Error("db error"));

    await useConversationStore.getState().sendAnnotationFire({
      nodeId: "node-1",
      annotationUuid: "ann-uuid-1",
      annotation: fakeAnnotation,
      content: "fire content",
      model: "test-model",
    });

    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
  });

  // --- Group P: llmDeleteAnnotationThreads preference (Cycle 4.4a) ---

  it("llmDeleteAnnotationThreads defaults to false", () => {
    expect(usePreferencesStore.getState().llmDeleteAnnotationThreads).toBe(false);
  });

  // --- Group Q: cleanupAnnotationThread (Cycle 4.4b) ---

  it("cleanupAnnotationThread deletes thread when preference enabled", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: true });
    mockedConversationDeleteByAnchor.mockResolvedValue(undefined);

    await useConversationStore.getState().cleanupAnnotationThread("node-1", "ann-uuid-1");

    expect(mockedConversationDeleteByAnchor).toHaveBeenCalledWith("node-1", "annotation", "ann-uuid-1");
  });

  it("cleanupAnnotationThread does nothing when preference disabled", async () => {
    await useConversationStore.getState().cleanupAnnotationThread("node-1", "ann-uuid-1");

    expect(mockedConversationDeleteByAnchor).not.toHaveBeenCalled();
  });

  it("cleanupAnnotationThread sets error when delete fails", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: true });
    mockedConversationDeleteByAnchor.mockRejectedValue(new Error("delete failed"));

    await useConversationStore.getState().cleanupAnnotationThread("node-1", "ann-uuid-1");

    expect(useConversationStore.getState().error).toBe("delete failed");
  });

  // --- Group R: cleanupAnnotationThread local state (Concern 1) ---

  it("cleanupAnnotationThread removes matching conversation from local conversations array", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: true });
    mockedConversationDeleteByAnchor.mockResolvedValue(undefined);
    const annConv: ConversationRow = {
      ...fakeConversation,
      id: "ann-conv-1",
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    };
    const otherConv: ConversationRow = { ...fakeConversation, id: "other-conv" };
    useConversationStore.setState({
      conversations: [annConv, otherConv],
    });

    await useConversationStore.getState().cleanupAnnotationThread("node-1", "ann-uuid-1");

    expect(useConversationStore.getState().conversations).toEqual([otherConv]);
  });

  it("cleanupAnnotationThread clears activeConversationId when deleted conversation was active", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: true });
    mockedConversationDeleteByAnchor.mockResolvedValue(undefined);
    const annConv: ConversationRow = {
      ...fakeConversation,
      id: "ann-conv-1",
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    };
    useConversationStore.setState({
      conversations: [annConv],
      activeConversationId: "ann-conv-1",
      messages: [fakeMessage],
    });

    await useConversationStore.getState().cleanupAnnotationThread("node-1", "ann-uuid-1");

    const s = useConversationStore.getState();
    expect(s.activeConversationId).toBeNull();
    expect(s.messages).toEqual([]);
    expect(s.conversations).toEqual([]);
  });

  it("cleanupAnnotationThread preserves activeConversationId when it points to a different conversation", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: true });
    mockedConversationDeleteByAnchor.mockResolvedValue(undefined);
    const annConv: ConversationRow = {
      ...fakeConversation,
      id: "ann-conv-1",
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    };
    const otherConv: ConversationRow = { ...fakeConversation, id: "other-conv" };
    const otherMsg: MessageRow = { ...fakeMessage, conversation_id: "other-conv" };
    useConversationStore.setState({
      conversations: [annConv, otherConv],
      activeConversationId: "other-conv",
      messages: [otherMsg],
    });

    await useConversationStore.getState().cleanupAnnotationThread("node-1", "ann-uuid-1");

    const s = useConversationStore.getState();
    expect(s.activeConversationId).toBe("other-conv");
    expect(s.messages).toEqual([otherMsg]);
    expect(s.conversations).toEqual([otherConv]);
  });

  // --- Group S: findOrCreateAnnotationThread error detection (Concern 2) ---

  it("findOrCreateAnnotationThread returns null when selectConversation fails to load messages", async () => {
    const existingConv: ConversationRow = {
      ...fakeConversation,
      id: "existing-conv-id",
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    };
    mockedConversationFindByAnchor.mockResolvedValue(existingConv);
    mockedConversationMessages.mockRejectedValue(new Error("messages load failed"));

    const id = await useConversationStore.getState().findOrCreateAnnotationThread("node-1", "ann-uuid-1");

    expect(id).toBeNull();
    expect(useConversationStore.getState().error).toBe("messages load failed");
  });

  it("sendAnnotationFire does not send message when selectConversation fails on existing thread", async () => {
    const existingConv: ConversationRow = {
      ...fakeConversation,
      id: "existing-conv-id",
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    };
    mockedConversationFindByAnchor.mockResolvedValue(existingConv);
    mockedConversationMessages.mockRejectedValue(new Error("messages load failed"));

    await useConversationStore.getState().sendAnnotationFire({
      nodeId: "node-1",
      annotationUuid: "ann-uuid-1",
      annotation: fakeAnnotation,
      content: "fire content",
      model: "test-model",
    });

    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useConversationStore.getState().error).toBe("messages load failed");
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

  // --- Group S: handleAnnotationsRemoved (Cycle 8.1d) ---

  it("handleAnnotationsRemoved calls cleanupAnnotationThread for each item", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: true });
    mockedConversationDeleteByAnchor.mockResolvedValue(undefined);

    await useConversationStore.getState().handleAnnotationsRemoved([
      { node_id: "node-1", uuid: "uuid-a" },
      { node_id: "node-2", uuid: "uuid-b" },
    ]);

    expect(mockedConversationDeleteByAnchor).toHaveBeenCalledTimes(2);
    expect(mockedConversationDeleteByAnchor).toHaveBeenCalledWith("node-1", "annotation", "uuid-a");
    expect(mockedConversationDeleteByAnchor).toHaveBeenCalledWith("node-2", "annotation", "uuid-b");
  });

  it("handleAnnotationsRemoved does nothing when preference disabled", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: false });

    await useConversationStore.getState().handleAnnotationsRemoved([
      { node_id: "node-1", uuid: "uuid-a" },
    ]);

    expect(mockedConversationDeleteByAnchor).not.toHaveBeenCalled();
  });

  it("handleAnnotationsRemoved does nothing with empty items", async () => {
    usePreferencesStore.setState({ llmDeleteAnnotationThreads: true });

    await useConversationStore.getState().handleAnnotationsRemoved([]);

    expect(mockedConversationDeleteByAnchor).not.toHaveBeenCalled();
  });

  // --- Group T: sendAnnotationFire race condition regression ---

  it("sendAnnotationFire posts to correct thread even when activeConversationId is sabotaged mid-flight", async () => {
    const THREAD_ID = "annotation-thread-id";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(THREAD_ID as `${string}-${string}-${string}-${string}-${string}`);
    mockedConversationFindByAnchor.mockResolvedValue(null);
    mockedConversationCreate.mockResolvedValue({
      ...fakeConversation,
      id: THREAD_ID,
      anchor_type: "annotation",
      anchor_key: "ann-uuid-1",
    });

    // Sabotage: as soon as activeConversationId is set to the correct thread,
    // a concurrent action overwrites it with a different value.
    const SABOTAGED_ID = "sabotaged-conv-id";
    const unsub = useConversationStore.subscribe((state) => {
      if (state.activeConversationId === THREAD_ID) {
        useConversationStore.setState({ activeConversationId: SABOTAGED_ID });
      }
    });

    const persistedMsg: MessageRow = {
      id: 10, conversation_id: THREAD_ID, role: "user",
      content: "fire content", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendAnnotationFire({
      nodeId: "node-1",
      annotationUuid: "ann-uuid-1",
      annotation: fakeAnnotation,
      content: "fire content",
      model: "test-model",
    });
    unsub();

    // The message must be posted to the correct annotation thread, NOT the sabotaged one.
    expect(mockedConversationAddMessage).toHaveBeenCalledWith(THREAD_ID, "user", "fire content");
  });

  // --- Group U: ensureUnlocked guard on LLM calls ---

  /** Flush microtask queue N times so pending awaits resolve before we settle. */
  const flush = (n = 5) =>
    Array.from({ length: n }).reduce<Promise<void>>(
      (p) => p.then(() => new Promise((r) => queueMicrotask(r))),
      Promise.resolve(),
    );

  it("sendMessage calls ensureUnlocked before persisting user message", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    const sendPromise = useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    await flush();

    expect(useSecretStoreStore.getState().promptOpen).toBe(true);
    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();

    useSecretStoreStore.getState().settleUnlock(true);
    await sendPromise;

    expect(mockedConversationAddMessage).toHaveBeenCalled();
    expect(mockedStartLlmStream).toHaveBeenCalled();
  });

  it("sendMessage sets error and returns early when ensureUnlocked is cancelled", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
    useConversationStore.setState({ activeConversationId: FAKE_UUID });

    const sendPromise = useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    await flush();
    useSecretStoreStore.getState().settleUnlock(false);
    await sendPromise;

    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useConversationStore.getState().error).toBe("Passphrase entry cancelled");
    expect(useConversationStore.getState().messages).toEqual([]);
    expect(useModalLockStore.getState().llmLocked).toBe(false);
  });

  it("sendMessage proceeds without prompting when store is already unlocked", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: true });
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    await useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    expect(useSecretStoreStore.getState().promptOpen).toBe(false);
    expect(mockedStartLlmStream).toHaveBeenCalled();
  });

  it("sendMessage prompts for passphrase when store does not exist", async () => {
    useSecretStoreStore.setState({ exists: false, unlocked: false });
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);
    mockedStartLlmStream.mockResolvedValue(undefined);

    const sendPromise = useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    // ensureUnlocked is reached before conversationAddMessage,
    // so prompt opens immediately
    await flush();
    expect(useSecretStoreStore.getState().promptOpen).toBe(true);
    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();

    // Simulate user creating passphrase
    useSecretStoreStore.getState().settleUnlock(true);
    await sendPromise;

    expect(mockedConversationAddMessage).toHaveBeenCalled();
    expect(mockedStartLlmStream).toHaveBeenCalled();
  });

  it("retryLastMessage sets error when ensureUnlocked is cancelled", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
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

    const retryPromise = useConversationStore.getState().retryLastMessage({ model: "m" });

    await flush();
    useSecretStoreStore.getState().settleUnlock(false);
    await retryPromise;

    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useConversationStore.getState().messages).toEqual([userMsg, assistantMsg]);
    expect(useConversationStore.getState().error).toBe("Passphrase entry cancelled");
  });

  it("editMessage sets error when ensureUnlocked is cancelled", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
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

    const editPromise = useConversationStore.getState().editMessage(1, "new content", { model: "m" });

    await flush();
    useSecretStoreStore.getState().settleUnlock(false);
    await editPromise;

    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
    expect(useConversationStore.getState().messages).toEqual([userMsg, assistantMsg]);
    expect(useConversationStore.getState().error).toBe("Passphrase entry cancelled");
  });

  it("sendMessage does NOT persist user message when ensureUnlocked is cancelled (orphan prevention)", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
    useConversationStore.setState({ activeConversationId: FAKE_UUID });
    const persistedMsg: MessageRow = {
      id: 10, conversation_id: FAKE_UUID, role: "user",
      content: "hello", seq: 1, created_at: "2025-01-01T00:00:01Z",
    };
    mockedConversationAddMessage.mockResolvedValue(persistedMsg);

    const sendPromise = useConversationStore.getState().sendMessage({
      content: "hello",
      model: "test-model",
    });

    await flush();
    useSecretStoreStore.getState().settleUnlock(false);
    await sendPromise;

    // The key assertion: conversationAddMessage must NOT have been called
    // because ensureUnlocked was cancelled BEFORE the message was persisted.
    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(useConversationStore.getState().messages).toEqual([]);
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
  });

  it("retryLastMessage does NOT delete messages when ensureUnlocked is cancelled (orphan prevention)", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
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

    const retryPromise = useConversationStore.getState().retryLastMessage({ model: "m" });

    await flush();
    useSecretStoreStore.getState().settleUnlock(false);
    await retryPromise;

    // The key assertion: conversationDeleteMessagesAfter must NOT have been called
    // because ensureUnlocked was cancelled BEFORE any DB mutation.
    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(useConversationStore.getState().messages).toEqual([userMsg, assistantMsg]);
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
  });

  it("editMessage does NOT delete or persist messages when ensureUnlocked is cancelled (orphan prevention)", async () => {
    useSecretStoreStore.setState({ exists: true, unlocked: false });
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

    const editPromise = useConversationStore.getState().editMessage(1, "new content", { model: "m" });

    await flush();
    useSecretStoreStore.getState().settleUnlock(false);
    await editPromise;

    // The key assertions: NO DB mutations should have occurred
    expect(mockedConversationDeleteMessagesAfter).not.toHaveBeenCalled();
    expect(mockedConversationAddMessage).not.toHaveBeenCalled();
    expect(useConversationStore.getState().messages).toEqual([userMsg, assistantMsg]);
    expect(mockedStartLlmStream).not.toHaveBeenCalled();
  });
});
