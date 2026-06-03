import { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import type { MessageRow, Annotation } from "../lib/ipc";
import { renderMarkdown } from "../lib/renderMarkdown";

interface MessageBubbleProps {
  message: MessageRow;
  isLast?: boolean;
  showEditorActions?: boolean;
  fireSourceAnnotation?: Annotation | null;
  onEdit?: (seq: number) => void;
  onEditSubmit?: (seq: number, newContent: string) => void;
  onRetry?: () => void;
}

function MessageBubbleInner({ message, isLast, showEditorActions, fireSourceAnnotation, onEdit, onEditSubmit, onRetry }: MessageBubbleProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const html = useMemo(() => renderMarkdown(message.content), [message.content]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [editing]);

  function handleCopy() {
    navigator.clipboard.writeText(message.content);
  }

  function handleEditClick() {
    onEdit?.(message.seq);
    setEditText(message.content);
    setEditing(true);
  }

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onEditSubmit?.(message.seq, editText);
      setEditing(false);
    } else if (e.key === "Escape") {
      setEditing(false);
    }
  }, [editText, message.seq, onEditSubmit]);

  const actions = !editing && (
    <div className="flex gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button data-testid="message-copy-btn" aria-label="Copy" onClick={handleCopy} className="text-xs text-muted hover:text-normal px-1">
        <span className="nerd-font" aria-hidden="true">{''}</span>
      </button>
      {isUser && onEdit && (
        <button data-testid="message-edit-btn" aria-label="Edit" onClick={handleEditClick} className="text-xs text-muted hover:text-normal px-1">
          <span className="nerd-font" aria-hidden="true">{''}</span>
        </button>
      )}
      {isAssistant && isLast && onRetry && (
        <button data-testid="message-retry-btn" aria-label="Retry" onClick={onRetry} className="text-xs text-muted hover:text-normal px-1">
          <span className="nerd-font" aria-hidden="true">{''}</span>
        </button>
      )}
      {isAssistant && showEditorActions && (
        <button
          data-testid="message-companion-btn"
          aria-label="Insert as companion"
          className="text-xs text-muted hover:text-normal px-1"
          onClick={() => {
            window.dispatchEvent(
              new CustomEvent("lit:insert-companion-annotation", {
                detail: { sourceAnnotation: fireSourceAnnotation ?? null, responseText: message.content },
              }),
            );
          }}
        >
          <span className="nerd-font" aria-hidden="true">{''}</span>
        </button>
      )}
    </div>
  );

  if (isUser) {
    return (
      <div
        data-testid="message-bubble-user"
        className="group self-end bg-chat-user text-chat-user-text rounded-tl-2xl rounded-tr-2xl rounded-bl-2xl rounded-br-md px-3 py-2 max-w-[80%] min-w-0 [overflow-wrap:anywhere]"
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            data-testid="message-edit-textarea"
            className="w-full bg-transparent border border-divider rounded p-1 text-sm resize-none"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={handleEditKeyDown}
          />
        ) : (
          <div className="prose prose-sm prose-on-user" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {actions}
      </div>
    );
  }

  return (
    <div
      data-testid="message-bubble-assistant"
      className="group self-start bg-chat-assistant text-chat-assistant-text rounded-tl-2xl rounded-tr-2xl rounded-br-2xl rounded-bl-md px-3 py-2 max-w-[80%] min-w-0 prose prose-sm prose-on-assistant [overflow-wrap:anywhere]"
    >
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {actions}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleInner);
