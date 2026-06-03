import { create } from "zustand";
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
  GLOBAL_NODE_ID,
  type Annotation,
  type ConversationRow,
  type MessageRow,
} from "../lib/ipc";
import { startLlmStream, cancelLlmStream } from "../lib/llmClient";
import { useLlmResponseStore } from "./llmResponse";
import { useModalLockStore } from "./modalLock";
import { usePreferencesStore } from "./preferences";
import { useSecretStoreStore } from "./secretStore";

interface StreamArgs {
  model: string;
  system?: string;
  nodeId?: string;
  neighborsDepth?: number;
  fireSourceAnnotation?: Annotation | null;
  textOverride?: string;
}

interface SendMessageArgs extends StreamArgs {
  content: string;
  textOverride?: string;
  conversationId?: string;
}

interface SendAnnotationFireArgs {
  nodeId: string;
  annotationUuid: string;
  annotation: Annotation;
  content: string;
  textOverride?: string;
  model: string;
  system?: string;
  neighborsDepth?: number;
  title?: string;
}

interface ConversationStore {
  activeConversationId: string | null;
  conversations: ConversationRow[];
  messages: MessageRow[];
  error: string | null;

  loadConversations: (nodeId: string) => Promise<void>;
  createConversation: (nodeId: string, title?: string, anchorType?: string, anchorKey?: string) => Promise<string | null>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  findOrCreateAnnotationThread: (nodeId: string, annotationUuid: string, title?: string) => Promise<string | null>;
  sendMessage: (args: SendMessageArgs) => Promise<void>;
  sendAnnotationFire: (args: SendAnnotationFireArgs) => Promise<void>;
  retryLastMessage: (args: StreamArgs) => Promise<void>;
  editMessage: (seq: number, newContent: string, args: StreamArgs) => Promise<void>;
  cancelConversationStream: () => Promise<void>;
  cleanupAnnotationThread: (nodeId: string, annotationUuid: string) => Promise<void>;
  handleAnnotationsRemoved: (items: Array<{ node_id: string; uuid: string }>) => Promise<void>;
  reset: () => void;
}

const initialState = {
  activeConversationId: null as string | null,
  conversations: [] as ConversationRow[],
  messages: [] as MessageRow[],
  error: null as string | null,
};

export const useConversationStore = create<ConversationStore>((set, get) => {
  let _streamGeneration = 0;

  const _streamAndPersist = async (
    convId: string,
    content: string,
    streamArgs: StreamArgs,
  ) => {
    const myGeneration = ++_streamGeneration;

    const storeMessages = get().messages;
    const messages = storeMessages.map((m, i) => ({
      role: m.role,
      content:
        m.role === "user" && i === storeMessages.length - 1
          ? content
          : m.content,
    }));

    const nodeId = streamArgs.nodeId ?? GLOBAL_NODE_ID;
    const neighborsDepth = streamArgs.neighborsDepth ?? 1;

    let finalSystem = streamArgs.system;
    let finalMessages: Array<{ role: string; content: string }> = messages;
    try {
      const built = await llmBuildContext({
        nodeId,
        systemPrompt: streamArgs.system,
        neighborsDepth,
        model: streamArgs.model,
        messages,
      });
      finalSystem = built.system;
      finalMessages = built.messages;
    } catch (e) {
      console.warn("llmBuildContext failed, using raw context:", e);
    }

    useLlmResponseStore.getState().startStream({
      question: content,
      fireSourceAnnotation: streamArgs.fireSourceAnnotation,
    });
    useModalLockStore.getState().setLlmLocked(true);

    try {
      await startLlmStream(
        {
          model: streamArgs.model,
          text: content,
          system: finalSystem,
          messages: finalMessages,
        },
        {
          onChunk: (text: string) => {
            if (myGeneration !== _streamGeneration) return;
            useLlmResponseStore.getState().appendChunk(text);
          },
          onDone: async () => {
            if (myGeneration !== _streamGeneration) return;
            const responseText = useLlmResponseStore.getState().responseText;
            try {
              const assistantMsg = await conversationAddMessage(
                convId,
                "assistant",
                responseText,
              );
              set((s) => ({ messages: [...s.messages, assistantMsg] }));
            } catch (e) {
              set({ error: e instanceof Error ? e.message : String(e) });
            } finally {
              useLlmResponseStore.getState().finishStream();
              useModalLockStore.getState().setLlmLocked(false);
            }
          },
          onError: (error: { message: string; retryable: boolean }) => {
            if (myGeneration !== _streamGeneration) return;
            useLlmResponseStore.getState().setError(error.message);
            useModalLockStore.getState().setLlmLocked(false);
          },
        },
      );
    } catch (e) {
      useLlmResponseStore.getState().setError(
        e instanceof Error ? e.message : String(e),
      );
      useModalLockStore.getState().setLlmLocked(false);
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  };

  return {
  ...initialState,

  loadConversations: async (nodeId: string) => {
    try {
      const rows = await conversationList(nodeId);
      set({ conversations: rows, activeConversationId: null, messages: [], error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  createConversation: async (nodeId: string, title?: string, anchorType?: string, anchorKey?: string) => {
    const id = crypto.randomUUID();
    try {
      const row = await conversationCreate(id, nodeId, anchorType, undefined, anchorKey, title);
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
    try {
      const msgs = await conversationMessages(id);
      set({ messages: msgs });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  deleteConversation: async (id: string) => {
    try {
      await conversationDelete(id);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
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
    const convId = args.conversationId ?? get().activeConversationId;
    if (convId === null) {
      set({ error: "No active conversation" });
      return;
    }
    if (useLlmResponseStore.getState().status === "streaming") return;

    try {
      await useSecretStoreStore.getState().ensureUnlocked();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    let userMsg: Awaited<ReturnType<typeof conversationAddMessage>>;
    try {
      userMsg = await conversationAddMessage(convId, "user", args.content);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    set((s) => ({ messages: [...s.messages, userMsg] }));

    const conv = get().conversations.find((c) => c.id === convId);
    if (conv && !conv.title) {
      const title = args.content.slice(0, 50);
      conversationUpdateTitle(convId, title).then(() => {
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === convId ? { ...c, title } : c,
          ),
        }));
      }).catch(() => {});
    }

    await _streamAndPersist(convId, args.textOverride ?? args.content, {
      model: args.model,
      system: args.system,
      nodeId: args.nodeId,
      neighborsDepth: args.neighborsDepth,
      fireSourceAnnotation: args.fireSourceAnnotation,
    });
  },

  findOrCreateAnnotationThread: async (nodeId: string, annotationUuid: string, title?: string) => {
    set({ error: null });
    try {
      const existing = await conversationFindByAnchor(nodeId, "annotation", annotationUuid);
      if (existing) {
        await get().selectConversation(existing.id);
        if (get().error) return null;
        return existing.id;
      }
      return await get().createConversation(nodeId, title, "annotation", annotationUuid);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  sendAnnotationFire: async (args: SendAnnotationFireArgs) => {
    const convId = await get().findOrCreateAnnotationThread(
      args.nodeId,
      args.annotationUuid,
      args.title,
    );
    if (convId === null) return;

    await get().sendMessage({
      content: args.content,
      textOverride: args.textOverride,
      model: args.model,
      system: args.system,
      nodeId: args.nodeId,
      neighborsDepth: args.neighborsDepth,
      fireSourceAnnotation: args.annotation,
      conversationId: convId,
    });
  },

  retryLastMessage: async (args: StreamArgs) => {
    const convId = get().activeConversationId;
    if (convId === null) return;
    if (useLlmResponseStore.getState().status === "streaming") return;

    const msgs = get().messages;
    if (msgs.length === 0 || msgs.at(-1)?.role !== "assistant") return;

    const lastUserIdx = msgs.findLastIndex((m) => m.role === "user");
    const lastUserMsg = lastUserIdx >= 0 ? msgs[lastUserIdx] : undefined;
    if (!lastUserMsg) return;

    try {
      await useSecretStoreStore.getState().ensureUnlocked();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    await conversationDeleteMessagesAfter(convId, lastUserMsg.seq);
    set((s) => ({ messages: s.messages.filter((m) => m.seq <= lastUserMsg.seq) }));

    await _streamAndPersist(convId, args.textOverride ?? lastUserMsg.content, args);
  },

  editMessage: async (seq: number, newContent: string, args: StreamArgs) => {
    const convId = get().activeConversationId;
    if (convId === null) return;
    if (useLlmResponseStore.getState().status === "streaming") return;

    try {
      await useSecretStoreStore.getState().ensureUnlocked();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    await conversationDeleteMessagesAfter(convId, seq - 1);
    set((s) => ({ messages: s.messages.filter((m) => m.seq < seq) }));

    let userMsg: Awaited<ReturnType<typeof conversationAddMessage>>;
    try {
      userMsg = await conversationAddMessage(convId, "user", newContent);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    set((s) => ({ messages: [...s.messages, userMsg] }));

    await _streamAndPersist(convId, args.textOverride ?? newContent, args);
  },

  cancelConversationStream: async () => {
    _streamGeneration++;
    useLlmResponseStore.getState().stopStream();
    useModalLockStore.getState().setLlmLocked(false);
    await cancelLlmStream();
  },

  cleanupAnnotationThread: async (nodeId: string, annotationUuid: string) => {
    if (!usePreferencesStore.getState().llmDeleteAnnotationThreads) return;
    try {
      await conversationDeleteByAnchor(nodeId, "annotation", annotationUuid);
      set((s) => {
        const match = (c: ConversationRow) =>
          c.node_id === nodeId &&
          c.anchor_type === "annotation" &&
          c.anchor_key === annotationUuid;
        const matchedId = s.conversations.find(match)?.id;
        const isActive = matchedId != null && s.activeConversationId === matchedId;
        return {
          conversations: s.conversations.filter((c) => !match(c)),
          activeConversationId: isActive ? null : s.activeConversationId,
          messages: isActive ? [] : s.messages,
        };
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  handleAnnotationsRemoved: async (items) => {
    await Promise.all(items.map((item) => get().cleanupAnnotationThread(item.node_id, item.uuid)));
  },

  reset: () => set(initialState),
};
});
