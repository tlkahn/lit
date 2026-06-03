import { useRef, useEffect, useCallback } from "react";
import type { MessageRow } from "../lib/ipc";
import { MessageBubble } from "./MessageBubble";
import { useLlmResponseStore } from "../stores/llmResponse";
import { renderMarkdown } from "../lib/renderMarkdown";

interface MessageListProps {
  messages: MessageRow[];
  onEdit: (seq: number) => void;
  onEditSubmit: (seq: number, newContent: string) => void;
  onRetry: () => void;
}

const SCROLL_THRESHOLD = 40;

export function MessageList({ messages, onEdit, onEditSubmit, onRetry }: MessageListProps) {
  const lastAssistantIdx = messages.findLastIndex((m) => m.role === "assistant");
  const status = useLlmResponseStore((s) => s.status);
  const responseText = useLlmResponseStore((s) => s.responseText);
  const errorMessage = useLlmResponseStore((s) => s.errorMessage);
  const fireSourceAnnotation = useLlmResponseStore((s) => s.fireSourceAnnotation);
  const showEditorActions = status !== "streaming";
  const scrollRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= SCROLL_THRESHOLD;
    userScrolledUpRef.current = !atBottom;
  }, []);

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages, responseText]);

  return (
    <div
      ref={scrollRef}
      data-testid="message-list"
      className="flex flex-col gap-2 overflow-y-auto p-2 h-full"
      onScroll={handleScroll}
    >
      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isLast={msg.role === "assistant" && i === lastAssistantIdx}
          showEditorActions={msg.role === "assistant" && i === lastAssistantIdx && showEditorActions}
          fireSourceAnnotation={fireSourceAnnotation}
          onEdit={onEdit}
          onEditSubmit={onEditSubmit}
          onRetry={onRetry}
        />
      ))}
      {status === "streaming" && (
        <div
          data-testid="streaming-bubble"
          className="self-start bg-chat-assistant text-chat-assistant-text rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-md px-3 py-2 max-w-[80%] min-w-0 prose prose-sm prose-on-assistant [overflow-wrap:anywhere]"
        >
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(responseText + "▍") }} />
        </div>
      )}
      {status === "error" && (
        <div data-testid="streaming-error" className="text-error text-sm px-3 py-2">
          {errorMessage}
        </div>
      )}
    </div>
  );
}
