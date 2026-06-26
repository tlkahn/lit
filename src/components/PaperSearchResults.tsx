import { useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { PaperSearchResult, BibEntry } from "../lib/ipc";
import { doiHref } from "../lib/urlUtils";
import { EntryTypeBadge } from "./EntryTypeBadge";
import { abbreviateAuthors, distinctPublisher } from "../lib/bibUtils";

interface PaperSearchResultsProps {
  results: PaperSearchResult;
  onSave: (entry: BibEntry) => void;
  savingKeys: Set<string>;
  savedKeys: Set<string>;
  duplicateKeys: Map<string, string>;
}

function entryStableKey(entry: BibEntry): string {
  return entry.doi ?? entry.key;
}


export function PaperSearchResults({
  results,
  onSave,
  savingKeys,
  savedKeys,
  duplicateKeys,
}: PaperSearchResultsProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const entries = results.entries;

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (index === expandedIndex ? 200 : 56),
    overscan: 10,
  });

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Provider status badges */}
      <div className="flex flex-wrap gap-1 px-2 pb-1">
        {results.providers_searched.map((p) => (
          <span
            key={p}
            className="rounded bg-interactive-accent/15 px-1.5 py-0.5 text-xs text-interactive-accent"
          >
            {p} ✓
          </span>
        ))}
        {results.providers_failed.map((p) => (
          <span
            key={p}
            className="rounded bg-text-error/15 px-1.5 py-0.5 text-xs text-text-error"
          >
            {p} ✗
          </span>
        ))}
      </div>

      <div className="px-2 pb-1 text-xs text-text-faint">
        {entries.length} result{entries.length !== 1 ? "s" : ""}
        {results.total_results > entries.length
          ? ` of ${results.total_results}`
          : ""}
      </div>

      <div
        ref={scrollRef}
        data-testid="search-results-list"
        data-virtual-scroll
        className="flex-1 overflow-y-auto overscroll-contain px-1"
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: "relative",
          }}
        >
          {virtualItems.map((virtualRow) => {
            const entry = entries[virtualRow.index];
            if (!entry) return null;
            const stableKey = entryStableKey(entry);
            const isSaving = savingKeys.has(stableKey);
            const isSaved = savedKeys.has(stableKey);
            const duplicateOf = duplicateKeys.get(stableKey);
            const isExpanded = expandedIndex === virtualRow.index;
            const pub = distinctPublisher(entry);

            return (
              <div
                key={stableKey}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <div
                  className="rounded px-2 py-1 hover:bg-bg-hover"
                  onClick={() => toggleExpand(virtualRow.index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ")
                      toggleExpand(virtualRow.index);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div
                        data-testid="search-result-title"
                        className="truncate text-sm text-text-normal"
                      >
                        {entry.title}
                      </div>
                      <div className="flex items-center gap-1 truncate text-xs text-text-muted">
                        <span className="truncate">
                          {abbreviateAuthors(entry.authors)}
                          {entry.year ? ` (${entry.year})` : ""}
                          {entry.journal ? ` — ${entry.journal}` : ""}
                          {pub ? ` — ${pub}` : ""}
                        </span>
                        <EntryTypeBadge entryType={entry.entry_type} />
                      </div>
                    </div>
                    <button
                      data-testid="save-to-library-btn"
                      disabled={isSaving || isSaved || !!duplicateOf}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSave(entry);
                      }}
                      className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
                    >
                      {isSaving
                        ? "Saving..."
                        : isSaved
                          ? "Saved"
                          : duplicateOf
                            ? "In library"
                            : "Save"}
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="mt-1 text-sm">
                      {entry.authors.length > 0 && (
                        <div className="text-xs text-text-muted">
                          {entry.authors.join("; ")}
                        </div>
                      )}
                      {pub && (
                        <div
                          data-testid="entry-publisher"
                          className="text-xs text-text-muted"
                        >
                          {pub}
                        </div>
                      )}
                      {(entry.volume || entry.number || entry.pages) && (
                        <div className="text-xs text-text-muted">
                          {[
                            entry.volume ? `vol. ${entry.volume}` : "",
                            entry.number ? `no. ${entry.number}` : "",
                            entry.pages ? `pp. ${entry.pages}` : "",
                          ]
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                      {entry.isbn && (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <a
                            data-testid="entry-isbn"
                            href={`https://openlibrary.org/isbn/${entry.isbn}`}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-interactive-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            ISBN {entry.isbn}
                          </a>
                        </div>
                      )}
                      {entry.doi && (
                        <div className="mt-1">
                          <a
                            href={doiHref(entry.doi)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-interactive-accent hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {entry.doi}
                          </a>
                        </div>
                      )}
                      {entry.abstract_text && (
                        <p className="mt-1 text-xs text-text-normal">
                          {entry.abstract_text}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
