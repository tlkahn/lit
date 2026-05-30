import { useEffect, useCallback, useRef } from "react";
import { useConversationStore } from "../stores/conversation";
import { usePreferencesStore } from "../stores/preferences";
import { GLOBAL_NODE_ID } from "../lib/ipc";
import { requestEditorContext } from "../lib/editorContext";
import { formatLlmPrompt } from "../lib/promptFormatter";
import { ThreadHeader } from "./ThreadHeader";
import { MessageList } from "./MessageList";
import { ConversationInput, type ConversationInputHandle } from "./ConversationInput";

interface ConversationPanelProps {
  pageId?: string;
  contentHeight?: number;
}

export function ConversationPanel({ pageId, contentHeight }: ConversationPanelProps) {
  const nodeId = pageId ?? GLOBAL_NODE_ID;
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
  const neighborsDepth = usePreferencesStore((s) => s.neighborsDepth);

  const inputRef = useRef<ConversationInputHandle>(null);

  useEffect(() => {
    loadConversations(nodeId).then(() => {
      const state = useConversationStore.getState();
      if (state.activeConversationId === null && state.conversations.length > 0) {
        const sorted = [...state.conversations].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
        selectConversation(sorted[0]!.id);
      }
      inputRef.current?.focus();
    });
  }, [nodeId, loadConversations, selectConversation]);

  const handleSend = useCallback(async (content: string) => {
    const convId = useConversationStore.getState().activeConversationId;
    if (convId === null) {
      const newId = await createConversation(nodeId, content.slice(0, 50));
      if (newId === null) return;
    }
    const editorCtx = requestEditorContext();
    const enriched = formatLlmPrompt({
      question: content,
      context: editorCtx.selectionText || undefined,
      filePath: editorCtx.filePath || undefined,
    });
    await sendMessage({
      content,
      model: llmModel,
      system: llmSystemPrompt || undefined,
      nodeId,
      neighborsDepth,
      textOverride: enriched !== content ? enriched : undefined,
    });
  }, [nodeId, createConversation, sendMessage, llmModel, llmSystemPrompt, neighborsDepth]);

  const handleNewThread = useCallback(async () => {
    await createConversation(nodeId);
    inputRef.current?.focus();
  }, [nodeId, createConversation]);

  const handleSelect = useCallback((id: string) => {
    selectConversation(id);
  }, [selectConversation]);

  const streamArgs = useCallback(() => ({
    model: llmModel,
    system: llmSystemPrompt || undefined,
    nodeId,
    neighborsDepth,
  }), [llmModel, llmSystemPrompt, nodeId, neighborsDepth]);

  const handleEditSubmit = useCallback((seq: number, newContent: string) => {
    editMessage(seq, newContent, streamArgs());
  }, [editMessage, streamArgs]);

  const handleRetry = useCallback(() => {
    retryLastMessage(streamArgs());
  }, [retryLastMessage, streamArgs]);

  const handleEdit = useCallback((_seq: number) => {}, []);

  const handleStop = useCallback(() => {
    cancelConversationStream();
  }, [cancelConversationStream]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "n") {
      e.preventDefault();
      handleNewThread();
    }
  }, [handleNewThread]);

  return (
    <div data-testid="conversation-panel" className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      <ThreadHeader
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelect={handleSelect}
        onNewThread={handleNewThread}
        onStop={handleStop}
      />
      <div
        data-testid="conversation-scroll-container"
        className="flex-1 overflow-hidden"
        style={contentHeight != null ? { height: contentHeight } : undefined}
      >
        <MessageList
          messages={messages}
          onEdit={handleEdit}
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
        ref={inputRef}
        onSend={handleSend}
        onNewThread={handleNewThread}
        onStop={handleStop}
      />
    </div>
  );
}
