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

import { startLlmStream } from "../lib/llmClient";
import { useLlmResponseStore } from "./llmResponse";
import { useModalLockStore } from "./modalLock";

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
    expect(mockedConversationCreate).toHaveBeenCalledWith(FAKE_UUID, "node-1");
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
