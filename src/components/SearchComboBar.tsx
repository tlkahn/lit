import { createPortal } from "react-dom";
import { useOverflowMenu } from "../hooks/useOverflowMenu";

interface SearchComboBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  mode: string;
  onModeChange: (value: string) => void;
  onSearch: () => void;
  searching: boolean;
}

const MODE_OPTIONS = [
  { value: "auto", label: "Auto" },
  { value: "keywords", label: "Keywords" },
  { value: "isbn", label: "ISBN" },
  { value: "doi", label: "DOI" },
  { value: "author", label: "Author" },
  { value: "title", label: "Title" },
] as const;

const MODE_LABELS: Record<string, string> = Object.fromEntries(
  MODE_OPTIONS.map((o) => [o.value, o.label]),
);

export function SearchComboBar({
  query,
  onQueryChange,
  mode,
  onModeChange,
  onSearch,
  searching,
}: SearchComboBarProps) {
  const { open, setOpen, triggerRef, menuRef } = useOverflowMenu({
    anchor: "below-left",
    dismissOnScroll: false,
  });

  const disabled = searching || !query.trim();

  return (
    <div className="flex items-stretch rounded-md border border-border bg-bg-primary focus-within:ring-1 focus-within:ring-interactive-accent">
      {/* Mode chip trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={`flex shrink-0 items-center gap-0.5 rounded-l-md border-r border-border px-1.5 text-xs hover:bg-bg-hover ${
          mode !== "auto" ? "text-interactive-accent" : "text-text-muted"
        }`}
        aria-label="Search mode"
      >
        <span>{MODE_LABELS[mode] ?? "Auto"}</span>
        <span className="text-[10px]">▾</span>
      </button>

      {/* Text input */}
      <input
        type="text"
        placeholder="Search academic papers..."
        aria-label="Search academic papers"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !disabled) onSearch();
        }}
        className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs text-text-normal outline-none"
      />

      {/* Search button */}
      <button
        data-testid="search-papers-btn"
        onClick={onSearch}
        disabled={disabled}
        className="shrink-0 rounded-r-md border-l border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
      >
        {searching ? "..." : "Search"}
      </button>

      {/* Hidden native select for test compatibility */}
      <select
        data-testid="search-mode-select"
        value={mode}
        onChange={(e) => onModeChange(e.target.value)}
        className="absolute h-0 w-0 overflow-hidden opacity-0"
        tabIndex={-1}
        aria-hidden="true"
      >
        {MODE_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {/* Portal dropdown */}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            data-testid="search-mode-dropdown"
            style={{ position: "fixed", left: 0, top: 0 }}
            className="z-50 min-w-[120px] select-none rounded-lg border border-border/20 bg-bg-primary/80 p-1 shadow-lg shadow-black/10 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
          >
            {MODE_OPTIONS.map((o) => {
              const active = mode === o.value;
              return (
                <button
                  key={o.value}
                  onClick={() => {
                    onModeChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center rounded-md px-3 py-1 text-start text-[13px] hover:bg-interactive-accent hover:text-text-on-accent ${
                    active ? "text-interactive-accent" : "text-text-normal"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
