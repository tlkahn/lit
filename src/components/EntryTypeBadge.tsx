/** Entry types that are too common/generic to badge. */
export const HIDDEN_ENTRY_TYPES = new Set(["article", "misc", ""]);

const BOOK_TYPES = new Set(["book", "inbook", "incollection"]);
const CONFERENCE_TYPES = new Set(["inproceedings", "proceedings", "conference"]);
const THESIS_TYPES = new Set(["phdthesis", "mastersthesis"]);

function badgeColors(entryType: string): { className: string; style?: React.CSSProperties } {
  if (BOOK_TYPES.has(entryType)) {
    return { className: "bg-interactive-accent/15 text-interactive-accent" };
  }
  if (CONFERENCE_TYPES.has(entryType)) {
    return {
      className: "",
      style: {
        color: "var(--color-purple)",
        backgroundColor: "color-mix(in srgb, var(--color-purple) 15%, transparent)",
      },
    };
  }
  if (THESIS_TYPES.has(entryType)) {
    return {
      className: "",
      style: {
        color: "var(--color-orange)",
        backgroundColor: "color-mix(in srgb, var(--color-orange) 15%, transparent)",
      },
    };
  }
  return { className: "bg-bg-hover text-text-muted" };
}

interface EntryTypeBadgeProps {
  entryType: string;
  className?: string;
}

export function EntryTypeBadge({ entryType, className }: EntryTypeBadgeProps) {
  if (HIDDEN_ENTRY_TYPES.has(entryType)) return null;
  const { className: colorClass, style } = badgeColors(entryType);
  return (
    <span
      data-testid="entry-type-badge"
      className={`rounded px-1.5 py-0.5 text-xs ${colorClass}${className ? ` ${className}` : ""}`}
      style={style}
    >
      {entryType}
    </span>
  );
}
