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
import { startLlmStream, cancelLlmStream } from "../lib/llmClient";
import { useLlmResponseStore } from "./llmResponse";
import { useModalLockStore } from "./modalLock";

interface StreamArgs {
  model: string;
  system?: string;
}

interface SendMessageArgs extends StreamArgs {
  content: string;
}

interface ConversationStore {
  activeConversationId: string | null;
  conversations: ConversationRow[];
  messages: MessageRow[];
  error: string | null;

  loadConversations: (nodeId: string) => Promise<void>;
  createConversation: (nodeId: string, title?: string) => Promise<string | null>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  sendMessage: (args: SendMessageArgs) => Promise<void>;
  cancelConversationStream: () => Promise<void>;
  reset: () => void;
}

const initialState = {
  activeConversationId: null as string | null,
  conversations: [] as ConversationRow[],
  messages: [] as MessageRow[],
  error: null as string | null,
};

export const useConversationStore = create<ConversationStore>((set, get) => {
  const _streamAndPersist = async (
    convId: string,
    content: string,
    streamArgs: StreamArgs,
  ) => {
    const messages = get().messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    useLlmResponseStore.getState().startStream({ question: content });
    useModalLockStore.getState().setLlmLocked(true);

    await startLlmStream(
      {
        model: streamArgs.model,
        text: content,
        system: streamArgs.system,
        messages,
      },
      {
        onChunk: (text: string) => {
          useLlmResponseStore.getState().appendChunk(text);
        },
        onDone: async () => {
          const responseText = useLlmResponseStore.getState().responseText;
          try {
            const assistantMsg = await conversationAddMessage(
              convId,
              "assistant",
              responseText,
            );
            set((s) => ({ messages: [...s.messages, assistantMsg] }));
          } finally {
            useLlmResponseStore.getState().finishStream();
            useModalLockStore.getState().setLlmLocked(false);
          }
        },
        onError: (error: { message: string; retryable: boolean }) => {
          useLlmResponseStore.getState().setError(error.message);
          useModalLockStore.getState().setLlmLocked(false);
        },
      },
    );
  };

  return {
  ...initialState,

  loadConversations: async (nodeId: string) => {
    try {
      const rows = await conversationList(nodeId);
      set({ conversations: rows, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createConversation: async (nodeId: string, title?: string) => {
    const id = crypto.randomUUID();
    try {
      const row = await conversationCreate(id, nodeId, undefined, undefined, title);
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

    let userMsg: Awaited<ReturnType<typeof conversationAddMessage>>;
    try {
      userMsg = await conversationAddMessage(convId, "user", args.content);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    set((s) => ({ messages: [...s.messages, userMsg] }));

    await _streamAndPersist(convId, args.content, {
      model: args.model,
      system: args.system,
    });
  },

  cancelConversationStream: async () => {
    useLlmResponseStore.getState().stopStream();
    useModalLockStore.getState().setLlmLocked(false);
    await cancelLlmStream();
  },

  reset: () => set(initialState),
};
});
