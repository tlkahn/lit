import { useState, useRef, useEffect, useCallback, memo } from "react";

interface GroupHeaderProps {
  name: string;
  cardCount: number;
  totalCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onRename: (name: string) => void;
}

export const GroupHeader = memo(function GroupHeader({
  name,
  cardCount,
  totalCount,
  collapsed,
  onToggleCollapse,
  onRename,
}: GroupHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    if (editing) {
      confirmedRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const confirmRename = useCallback(() => {
    confirmedRef.current = true;
    const trimmed = draft.trim();
    onRename(trimmed || name);
    setEditing(false);
  }, [draft, name, onRename]);

  const cancelRename = useCallback(() => {
    setDraft(name);
    setEditing(false);
  }, [name]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        confirmRename();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    },
    [confirmRename, cancelRename],
  );

  return (
    <div
      className="cardbox-group-header"
      data-testid="group-header"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={onToggleCollapse}
        className="group-collapse-chevron"
        data-testid="group-collapse-toggle"
        data-collapsed={collapsed ? "true" : "false"}
        aria-label={collapsed ? "Expand group" : "Collapse group"}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (!confirmedRef.current) {
              cancelRename();
            }
            confirmedRef.current = false;
          }}
          className="group-name-input"
          data-testid="group-name-input"
        />
      ) : (
        <span
          className="group-name"
          data-testid="group-name"
          onDoubleClick={() => {
            setEditing(true);
            setDraft(name);
          }}
        >
          {name}
        </span>
      )}

      <span className="group-count" data-testid="group-card-count">
        {cardCount === totalCount ? `${totalCount}` : `${cardCount}/${totalCount}`}
      </span>
    </div>
  );
});
