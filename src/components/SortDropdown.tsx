import { createPortal } from "react-dom";
import { useOverflowMenu } from "../hooks/useOverflowMenu";
import type { SortConfig, SortKey } from "../lib/pageSort";

interface SortDropdownProps {
  sortConfig: SortConfig;
  onSelectKey: (key: SortKey) => void;
}

const LABELS: Record<SortKey, string> = {
  title: "File name",
  modified_at: "Modified time",
  created_at: "Created time",
};

const KEYS: SortKey[] = ["title", "modified_at", "created_at"];

export function SortDropdown({ sortConfig, onSelectKey }: SortDropdownProps) {
  const { open, setOpen, triggerRef, menuRef } = useOverflowMenu({
    dismissOnScroll: false,
  });

  const isDefault = sortConfig.key === "title" && sortConfig.direction === "asc";

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        aria-label="Sort files"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm hover:bg-bg-hover ${
          isDefault ? "text-text-faint" : "text-interactive-accent"
        }`}
      >
        <span className="nerd-font" aria-hidden="true">{sortConfig.direction === 'asc' ? '' : ''}</span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          data-testid="sort-dropdown-menu"
          style={{ position: "fixed", left: 0, top: 0 }}
          className="z-50 min-w-[160px] select-none rounded-lg border border-border/20 bg-bg-primary/80 p-1 shadow-lg shadow-black/10 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
        >
          {KEYS.map((key) => {
            const active = sortConfig.key === key;
            return (
              <button
                key={key}
                onClick={() => {
                  onSelectKey(key);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-3 py-1 text-start text-xs hover:bg-interactive-accent hover:text-text-on-accent ${
                  active ? "text-interactive-accent" : "text-text-normal"
                }`}
              >
                <span>{LABELS[key]}</span>
                {active && (
                  <span className="ml-2 text-xs">
                    {sortConfig.direction === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
