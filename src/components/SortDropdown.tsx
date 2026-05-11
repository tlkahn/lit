import { useState, useEffect, useRef } from "react";
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
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const isDefault = sortConfig.key === "title" && sortConfig.direction === "asc";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Sort files"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-sm hover:bg-bg-hover ${
          isDefault ? "text-text-faint" : "text-interactive-accent"
        }`}
      >
        ⇅
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[160px] select-none rounded-lg border border-border/40 bg-bg-primary/80 p-1 shadow-xl shadow-black/20 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70">
          {KEYS.map((key) => {
            const active = sortConfig.key === key;
            return (
              <button
                key={key}
                onClick={() => {
                  onSelectKey(key);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-md px-3 py-1 text-start text-[13px] hover:bg-interactive-accent hover:text-text-on-accent ${
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
        </div>
      )}
    </div>
  );
}
