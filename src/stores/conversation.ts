import { create } from "zustand";
import {
  conversationList,
  conversationCreate,
  conversationDelete,
  conversationMessages,
  conversationAddMessage,
  type ConversationRow,
  type MessageRow,
} from "../lib/ipc";
import { startLlmStream } from "../lib/llmClient";
import { useLlmResponseStore } from "./llmResponse";
import { useModalLockStore } from "./modalLock";

interface SendMessageArgs {
  content: string;
  model: string;
  system?: string;
}

interface ConversationStore {
  activeConversationId: string | null;
  conversations: ConversationRow[];
  messages: MessageRow[];
  error: string | null;

  loadConversations: (nodeId: string) => Promise<void>;
  createConversation: (nodeId: string) => Promise<string | null>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (args: SendMessageArgs) => Promise<void>;
  reset: () => void;
}

const initialState = {
  activeConversationId: null as string | null,
  conversations: [] as ConversationRow[],
  messages: [] as MessageRow[],
  error: null as string | null,
};

export const useConversationStore = create<ConversationStore>((set, get) => ({
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
    try {
      const row = await conversationCreate(id, nodeId);
      set((s) => ({
        conversations: [...s.conversations, row],
        activeConversationId: id,
        messages: [],
      }));
      return id;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  selectConversation: async (id: string) => {
    set({ activeConversationId: id, messages: [] });
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

  sendMessage: async (args: SendMessageArgs) => {
    const convId = get().activeConversationId;
    if (convId === null) {
      set({ error: "No active conversation" });
      return;
    }
    if (useLlmResponseStore.getState().status === "streaming") return;

    const userMsg = await conversationAddMessage(convId, "user", args.content);
    set((s) => ({ messages: [...s.messages, userMsg] }));

    const messages = get().messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    useLlmResponseStore.getState().startStream({ question: args.content });
    useModalLockStore.getState().setLlmLocked(true);

    await startLlmStream(
      {
        model: args.model,
        text: args.content,
        system: args.system,
        messages,
      },
      {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {},
      },
    );
  },

  reset: () => set(initialState),
}));
