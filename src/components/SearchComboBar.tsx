import { useEffect } from "react";
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

  useEffect(() => {
    if (open && menuRef.current) {
      menuRef.current.focus();
    }
  }, [open]);

  const disabled = searching || !query.trim();

  return (
    <div className="flex items-stretch rounded-md border border-border bg-bg-primary">
      {/* Mode chip trigger */}
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={`flex shrink-0 items-center gap-0.5 rounded-l-md border-r border-border px-1.5 text-xs hover:bg-bg-hover ${
          mode !== "auto" ? "text-interactive-accent" : "text-text-muted"
        }`}
        aria-label="Search mode"
        aria-haspopup="listbox"
        aria-expanded={open}
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

      {/* Portal dropdown */}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            data-testid="search-mode-dropdown"
            role="listbox"
            tabIndex={0}
            style={{ position: "fixed", left: 0, top: 0 }}
            className="z-50 min-w-[120px] select-none rounded-lg border border-border/20 bg-bg-primary/80 p-1 shadow-lg shadow-black/10 backdrop-blur-xl backdrop-saturate-150 outline-none dark:border-border/10 dark:bg-bg-primary/70"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const buttons = Array.from(
                  menuRef.current?.querySelectorAll<HTMLElement>("button") ?? [],
                );
                const currentIndex = buttons.indexOf(document.activeElement as HTMLElement);
                const next =
                  e.key === "ArrowDown"
                    ? (currentIndex + 1) % buttons.length
                    : (currentIndex - 1 + buttons.length) % buttons.length;
                buttons[next]?.focus();
              } else if (e.key === "Enter") {
                e.preventDefault();
                const buttons = Array.from(
                  menuRef.current?.querySelectorAll<HTMLElement>("button") ?? [],
                );
                const currentIndex = buttons.indexOf(document.activeElement as HTMLElement);
                if (currentIndex >= 0) buttons[currentIndex]!.click();
              }
            }}
          >
            {MODE_OPTIONS.map((o) => {
              const active = mode === o.value;
              return (
                <button
                  key={o.value}
                  role="option"
                  aria-selected={active}
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
