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

import {
  conversationList,
  conversationCreate,
  conversationDelete,
  conversationMessages,
} from "../lib/ipc";
import type { ConversationRow, MessageRow } from "../lib/ipc";

const mockedConversationList = conversationList as ReturnType<typeof vi.fn>;
const mockedConversationCreate = conversationCreate as ReturnType<typeof vi.fn>;
const mockedConversationDelete = conversationDelete as ReturnType<typeof vi.fn>;
const mockedConversationMessages = conversationMessages as ReturnType<typeof vi.fn>;

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
