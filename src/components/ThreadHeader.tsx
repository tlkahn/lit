import type { ConversationRow } from "../lib/ipc";
import { useLlmResponseStore } from "../stores/llmResponse";
import { ThreadSelector } from "./ThreadSelector";

interface ThreadHeaderProps {
  conversations: ConversationRow[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  onNewThread: () => void;
  onStop: () => void;
  firstUserMessages?: Record<string, string>;
}

export function ThreadHeader({
  conversations,
  activeConversationId,
  onSelect,
  onNewThread,
  onStop,
  firstUserMessages,
}: ThreadHeaderProps) {
  const status = useLlmResponseStore((s) => s.status);

  return (
    <div className="flex items-center justify-between border-b border-divider px-2 py-1">
      <div className="flex items-center gap-2">
        <ThreadSelector
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={onSelect}
          firstUserMessages={firstUserMessages}
        />
        <button
          data-testid="new-thread-btn"
          onClick={onNewThread}
          className="rounded-md px-2 py-1 text-sm text-text-muted hover:bg-bg-tertiary hover:text-text-normal"
        >
          + New
        </button>
      </div>
      {status === "streaming" && (
        <button
          data-testid="conv-stop-btn"
          onClick={onStop}
          className="rounded-md px-2 py-1 text-sm text-red-500 hover:bg-bg-tertiary"
        >
          Stop
        </button>
      )}
    </div>
  );
}
