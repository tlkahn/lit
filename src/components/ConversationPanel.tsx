import { useEffect, useCallback } from "react";
import { useConversationStore } from "../stores/conversation";
import { usePreferencesStore } from "../stores/preferences";
import { ThreadHeader } from "./ThreadHeader";
import { MessageList } from "./MessageList";
import { ConversationInput } from "./ConversationInput";

interface ConversationPanelProps {
  pageId: string;
  contentHeight?: number;
}

export function ConversationPanel({ pageId }: ConversationPanelProps) {
  const conversations = useConversationStore((s) => s.conversations);
  const activeConversationId = useConversationStore((s) => s.activeConversationId);
  const messages = useConversationStore((s) => s.messages);
  const error = useConversationStore((s) => s.error);
  const loadConversations = useConversationStore((s) => s.loadConversations);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const createConversation = useConversationStore((s) => s.createConversation);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const editMessage = useConversationStore((s) => s.editMessage);
  const retryLastMessage = useConversationStore((s) => s.retryLastMessage);
  const cancelConversationStream = useConversationStore((s) => s.cancelConversationStream);

  const llmModel = usePreferencesStore((s) => s.llmModel);
  const llmSystemPrompt = usePreferencesStore((s) => s.llmSystemPrompt);

  useEffect(() => {
    loadConversations(pageId).then(() => {
      const state = useConversationStore.getState();
      if (state.activeConversationId === null && state.conversations.length > 0) {
        const sorted = [...state.conversations].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        selectConversation(sorted[0]!.id);
      }
    });
  }, [pageId, loadConversations, selectConversation]);

  const handleSend = useCallback(async (content: string) => {
    const convId = useConversationStore.getState().activeConversationId;
    if (convId === null) {
      await createConversation(pageId, content.slice(0, 50));
    }
    await sendMessage({
      content,
      model: llmModel,
      system: llmSystemPrompt || undefined,
    });
  }, [pageId, createConversation, sendMessage, llmModel, llmSystemPrompt]);

  const handleNewThread = useCallback(() => {
    createConversation(pageId);
  }, [pageId, createConversation]);

  const handleSelect = useCallback((id: string) => {
    selectConversation(id);
  }, [selectConversation]);

  const streamArgs = useCallback(() => ({
    model: llmModel,
    system: llmSystemPrompt || undefined,
  }), [llmModel, llmSystemPrompt]);

  const handleEditSubmit = useCallback((seq: number, newContent: string) => {
    editMessage(seq, newContent, streamArgs());
  }, [editMessage, streamArgs]);

  const handleRetry = useCallback(() => {
    retryLastMessage(streamArgs());
  }, [retryLastMessage, streamArgs]);

  const handleStop = useCallback(() => {
    cancelConversationStream();
  }, [cancelConversationStream]);

  return (
    <div data-testid="conversation-panel" className="flex flex-col h-full">
      <ThreadHeader
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelect}
        onNewThread={handleNewThread}
        onStop={handleStop}
      />
      <div className="flex-1 overflow-hidden">
        <MessageList
          messages={messages}
          onEdit={() => {}}
          onEditSubmit={handleEditSubmit}
          onRetry={handleRetry}
        />
      </div>
      {error && (
        <div data-testid="conversation-error" className="px-3 py-1 text-sm text-error">
          {error}
        </div>
      )}
      <ConversationInput
        onSend={handleSend}
        onNewThread={handleNewThread}
        onStop={handleStop}
      />
    </div>
  );
}
