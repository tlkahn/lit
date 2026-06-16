/** Entry types that are too common/generic to badge. */
export const HIDDEN_ENTRY_TYPES = new Set(["article", "misc", ""]);

interface EntryTypeBadgeProps {
  entryType: string;
  className?: string;
}

export function EntryTypeBadge({ entryType, className }: EntryTypeBadgeProps) {
  if (HIDDEN_ENTRY_TYPES.has(entryType)) return null;
  return (
    <span
      data-testid="entry-type-badge"
      className={`rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted${className ? ` ${className}` : ""}`}
    >
      {entryType}
    </span>
  );
}
