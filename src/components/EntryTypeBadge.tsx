/** Entry types that are too common/generic to badge. */
export const HIDDEN_ENTRY_TYPES = new Set(["article", "misc", ""]);

const BOOK_TYPES = new Set(["book", "inbook", "incollection"]);
const CONFERENCE_TYPES = new Set(["inproceedings", "proceedings", "conference"]);
const THESIS_TYPES = new Set(["phdthesis", "mastersthesis"]);

function cssVarBadgeStyle(cssVar: string): { className: string; style: React.CSSProperties } {
  return {
    className: "",
    style: {
      color: cssVar,
      backgroundColor: `color-mix(in srgb, ${cssVar} 15%, transparent)`,
    },
  };
}

function badgeColors(entryType: string): { className: string; style?: React.CSSProperties } {
  if (BOOK_TYPES.has(entryType)) {
    return { className: "bg-interactive-accent/15 text-interactive-accent" };
  }
  if (CONFERENCE_TYPES.has(entryType)) {
    return cssVarBadgeStyle("var(--color-purple)");
  }
  if (THESIS_TYPES.has(entryType)) {
    return cssVarBadgeStyle("var(--color-orange)");
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
      className={`rounded px-1.5 py-0.5 text-xs ${colorClass}${className ? ` ${className}` : ""}`.trim()}
      style={style}
    >
      {entryType}
    </span>
  );
}
