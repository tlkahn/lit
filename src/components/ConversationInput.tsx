import { useState, useRef, useEffect } from "react";
import { useLlmResponseStore } from "../stores/llmResponse";

interface ConversationInputProps {
  onSend: (content: string) => void;
  onNewThread?: () => void;
  onStop?: () => void;
}

export function ConversationInput({ onSend, onNewThread, onStop }: ConversationInputProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const status = useLlmResponseStore((s) => s.status);
  const isStreaming = status === "streaming";

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="flex items-end gap-1 px-3 py-2 border-t border-divider">
      <textarea
        ref={textareaRef}
        data-testid="conversation-input"
        className="flex-1 resize-none rounded border border-divider bg-bg-primary px-2 py-1 text-sm outline-none focus:border-accent"
        style={{ overflow: "hidden" }}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            handleSend();
          }
          if ((e.metaKey || e.ctrlKey) && e.key === "n") {
            e.preventDefault();
            onNewThread?.();
          }
        }}
        placeholder="Send a message..."
      />
      {isStreaming ? (
        <button
          data-testid="conversation-stop-btn"
          className="rounded border border-transparent bg-bg-hover px-3 py-1 text-sm text-text-muted hover:bg-bg-hover"
          onClick={onStop}
        >
          Stop
        </button>
      ) : (
        <button
          data-testid="conversation-send-btn"
          className="rounded border border-transparent bg-interactive-accent px-3 py-1 text-sm text-text-on-accent hover:bg-interactive-accent-hover disabled:opacity-50"
          onClick={handleSend}
        >
          Send
        </button>
      )}
    </div>
  );
}
