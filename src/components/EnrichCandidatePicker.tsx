import { useEffect, useState, useCallback, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { BibEntry } from "../lib/ipc";
import { abbreviateAuthors } from "../lib/bibUtils";
import { EntryTypeBadge } from "./EntryTypeBadge";

interface EnrichCandidatePickerProps {
  open: boolean;
  bibKey: string;
  candidates: BibEntry[];
  providersSearched: string[];
  providersFailed: string[];
  onApply: (candidate: BibEntry) => void;
  onClose: () => void;
}

export function EnrichCandidatePicker({
  open,
  bibKey,
  candidates,
  providersSearched,
  providersFailed,
  onApply,
  onClose,
}: EnrichCandidatePickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when picker opens
  useEffect(() => {
    if (open) setSelectedIndex(0);
  }, [open]);

  // Scroll selected candidate into view
  useEffect(() => {
    if (!open) return;
    const card = listRef.current?.querySelector(
      `[data-candidate-index="${selectedIndex}"]`,
    );
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest" });
    }
  }, [open, selectedIndex]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < candidates.length - 1 ? prev + 1 : prev,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
          break;
        case "Enter":
          if (document.activeElement instanceof HTMLButtonElement) break;
          e.preventDefault();
          if (candidates.length > 0) {
            onApply(candidates[selectedIndex]!);
          }
          break;
      }
    },
    [onClose, onApply, candidates, selectedIndex],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="enrich-picker-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[80vh] w-[36rem] flex-col rounded-lg bg-bg-primary"
        data-testid="enrich-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Select matching entry for ${bibKey}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="text-base font-semibold text-text-normal">
            Select matching entry for {bibKey}
          </h2>
          <button
            className="rounded p-1 text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="enrich-picker-close"

          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Provider status badges + result count */}
        <div className="px-5 pb-3">
          <div className="flex flex-wrap gap-1">
            {providersSearched.map((p) => (
              <span
                key={`ok-${p}`}
                className="rounded bg-interactive-accent/15 px-1.5 py-0.5 text-xs text-interactive-accent"
              >
                {p} ✓
              </span>
            ))}
            {providersFailed.map((p) => (
              <span
                key={`fail-${p}`}
                className="rounded bg-text-error/15 px-1.5 py-0.5 text-xs text-text-error"
              >
                {p} ✗
              </span>
            ))}
          </div>
          <div className="mt-1 text-xs text-text-faint">
            {candidates.length} candidate{candidates.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Scrollable candidate list */}
        <div
          ref={listRef}
          className="flex-1 space-y-2 overflow-y-auto px-5 pb-5"
          data-testid="enrich-picker-list"
          role="listbox"
          aria-label={`Enrichment candidates for ${bibKey}`}
          aria-activedescendant={`enrich-candidate-${selectedIndex}`}
        >
          {candidates.map((candidate, index) => (
            <div
              key={index}
              data-candidate-index={index}
              id={`enrich-candidate-${index}`}
              role="option"
              aria-selected={index === selectedIndex}
              className={`rounded border p-3 ${
                index === selectedIndex
                  ? "border-interactive-accent bg-bg-hover"
                  : "border-border bg-bg-secondary"
              }`}
              data-testid="enrich-candidate-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  {/* Title */}
                  <div className="text-sm font-semibold text-text-normal">
                    {candidate.title}
                  </div>

                  {/* Authors + year + journal + entry_type badge */}
                  <div className="mt-0.5 flex items-center gap-1 text-xs text-text-muted">
                    <span className="truncate">
                      {abbreviateAuthors(candidate.authors)}
                      {candidate.year ? ` (${candidate.year})` : ""}
                      {candidate.journal ? ` — ${candidate.journal}` : ""}
                    </span>
                    <EntryTypeBadge entryType={candidate.entry_type} className="shrink-0" />
                  </div>

                  {/* DOI if present */}
                  {candidate.doi && (
                    <div className="mt-0.5 text-xs text-text-faint">{candidate.doi}</div>
                  )}

                  {/* Abstract preview */}
                  {candidate.abstract_text && (
                    <p className="mt-1 line-clamp-3 text-xs text-text-muted">
                      {candidate.abstract_text}
                    </p>
                  )}
                </div>

                {/* Apply button */}
                <button
                  data-testid="enrich-apply-btn"

                  onClick={() => onApply(candidate)}
                  className="shrink-0 rounded bg-interactive-accent px-3 py-1.5 text-xs text-text-on-accent hover:opacity-90"
                >
                  Apply
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-5 pb-5 pt-3">
          <button
            data-testid="enrich-picker-cancel-btn"

            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
