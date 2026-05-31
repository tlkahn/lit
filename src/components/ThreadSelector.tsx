import type { ConversationRow } from "../lib/ipc";

interface ThreadSelectorProps {
  conversations: ConversationRow[];
  activeConversationId: string | null;
  onSelect: (id: string) => void;
  firstUserMessages?: Record<string, string>;
}

function getDisplayTitle(
  conv: ConversationRow,
  firstUserMessages?: Record<string, string>,
): string {
  if (conv.title) return conv.title;
  const firstMsg = firstUserMessages?.[conv.id];
  if (firstMsg) {
    return firstMsg.length > 50 ? firstMsg.slice(0, 49) + "…" : firstMsg;
  }
  return "Untitled thread";
}

export function ThreadSelector({
  conversations,
  activeConversationId,
  onSelect,
  firstUserMessages,
}: ThreadSelectorProps) {
  if (conversations.length === 0) {
    return (
      <select
        data-testid="thread-selector"
        disabled
        className="rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-muted outline-none"
      >
        <option>No threads</option>
      </select>
    );
  }

  // A controlled <select> whose value matches no <option> renders blank and
  // collapses to zero width (selectedIndex = -1 in real browsers). When the
  // active id is null or stale, fall back to an explicit placeholder option so
  // the selection is always valid and the box stays visible (bug #234).
  const hasMatch =
    activeConversationId != null &&
    conversations.some((conv) => conv.id === activeConversationId);

  return (
    <select
      data-testid="thread-selector"
      value={hasMatch ? activeConversationId! : ""}
      onChange={(e) => onSelect(e.target.value)}
      className="rounded-md bg-bg-tertiary px-2.5 py-1 text-sm text-text-normal outline-none focus:ring-1 focus:ring-accent"
    >
      {!hasMatch && (
        <option value="" disabled>
          Select thread…
        </option>
      )}
      {conversations.map((conv) => (
        <option key={conv.id} value={conv.id}>
          {getDisplayTitle(conv, firstUserMessages)}
        </option>
      ))}
    </select>
  );
}
