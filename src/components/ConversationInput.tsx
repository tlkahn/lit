import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import { useLlmResponseStore } from "../stores/llmResponse";

export interface ConversationInputHandle {
  focus: () => void;
}

interface ConversationInputProps {
  onSend: (content: string) => void | Promise<void>;
  onNewThread?: () => void;
  onStop?: () => void;
}

export const ConversationInput = forwardRef<ConversationInputHandle, ConversationInputProps>(
  function ConversationInput({ onSend, onNewThread, onStop }, ref) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));
  const status = useLlmResponseStore((s) => s.status);
  const isStreaming = status === "streaming";

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }, [value]);

  const handleSend = async () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
      await onSend(trimmed);
      setValue("");
    } catch {
      // preserve textarea content on failure
    }
  };

  return (
    <div className="flex items-end gap-1 px-3 py-2 border-t border-border" style={{ backgroundColor: "color-mix(in srgb, var(--background-primary) 60%, var(--background-secondary))" }}>
      <textarea
        ref={textareaRef}
        data-testid="conversation-input"
        className="flex-1 resize-none rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:border-accent"
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
            e.stopPropagation();
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
});
