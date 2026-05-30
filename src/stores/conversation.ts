import { create } from "zustand";
import {
  conversationList,
  conversationCreate,
  conversationDelete,
  conversationMessages,
  type ConversationRow,
  type MessageRow,
} from "../lib/ipc";

interface ConversationStore {
  activeConversationId: string | null;
  conversations: ConversationRow[];
  messages: MessageRow[];
  error: string | null;

  loadConversations: (nodeId: string) => Promise<void>;
  createConversation: (nodeId: string) => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  reset: () => void;
}

const initialState = {
  activeConversationId: null as string | null,
  conversations: [] as ConversationRow[],
  messages: [] as MessageRow[],
  error: null as string | null,
};

export const useConversationStore = create<ConversationStore>((set) => ({
  ...initialState,

  loadConversations: async (nodeId: string) => {
    try {
      const rows = await conversationList(nodeId);
      set({ conversations: rows, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createConversation: async (nodeId: string) => {
    const id = crypto.randomUUID();
    const row = await conversationCreate(id, nodeId);
    set((s) => ({
      conversations: [...s.conversations, row],
      activeConversationId: id,
      messages: [],
    }));
    return id;
  },

  selectConversation: async (id: string) => {
    set({ activeConversationId: id });
    const msgs = await conversationMessages(id);
    set({ messages: msgs });
  },

  deleteConversation: async (id: string) => {
    await conversationDelete(id);
    set((s) => {
      const isActive = s.activeConversationId === id;
      return {
        conversations: s.conversations.filter((c) => c.id !== id),
        activeConversationId: isActive ? null : s.activeConversationId,
        messages: isActive ? [] : s.messages,
      };
    });
  },

  reset: () => set(initialState),
}));
