import { useState, useRef, useEffect, useCallback } from "react";
import type { MessageRow } from "../lib/ipc";
import { renderMarkdown } from "../lib/renderMarkdown";

interface MessageBubbleProps {
  message: MessageRow;
  isLast?: boolean;
  onEdit?: (seq: number) => void;
  onEditSubmit?: (seq: number, newContent: string) => void;
  onRetry?: () => void;
}

export function MessageBubble({ message, isLast, onEdit, onEditSubmit, onRetry }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

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

  const actions = hovered && !editing && (
    <div className="flex gap-1 mt-1">
      <button data-testid="message-copy-btn" onClick={handleCopy} className="text-xs text-muted hover:text-normal px-1">
        Copy
      </button>
      {isUser && onEdit && (
        <button data-testid="message-edit-btn" onClick={handleEditClick} className="text-xs text-muted hover:text-normal px-1">
          Edit
        </button>
      )}
      {isAssistant && isLast && onRetry && (
        <button data-testid="message-retry-btn" onClick={onRetry} className="text-xs text-muted hover:text-normal px-1">
          Retry
        </button>
      )}
    </div>
  );

  if (isUser) {
    return (
      <div
        data-testid="message-bubble-user"
        className="self-end bg-interactive-accent text-on-accent rounded-lg px-3 py-2 max-w-[80%]"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
          message.content
        )}
        {actions}
      </div>
    );
  }

  return (
    <div
      data-testid="message-bubble-assistant"
      className="self-start bg-secondary rounded-lg px-3 py-2 max-w-[80%] prose prose-sm"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }} />
      {actions}
    </div>
  );
}
