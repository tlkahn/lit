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

const FAKE_UUID = "00000000-0000-0000-0000-000000000001";

const fakeConversation: ConversationRow = {
  id: FAKE_UUID,
  node_id: "node-1",
  anchor_type: null,
  anchor_id: null,
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
    expect(mockedConversationCreate).toHaveBeenCalledWith(FAKE_UUID, "node-1", undefined, undefined, undefined);
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

    expect(mockedConversationCreate).toHaveBeenCalledWith(FAKE_UUID, "node-1", undefined, undefined, "My question");
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
});
