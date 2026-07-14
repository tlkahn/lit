import { useRef, useEffect, useState, useCallback, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { useSearchPanelStore } from "../stores/searchPanel";
import { useWorkspaceStore } from "../stores/workspace";
import { listFolders, searchTags, type TagSearchResult } from "../lib/ipc";
import { navigateToNote } from "../lib/navigateToNote";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { IndexBuildingPlaceholder } from "./IndexBuildingPlaceholder";
import { SpinnerSvg } from "./SpinnerSvg";

// ---------------------------------------------------------------------------
// SearchResultRow
// ---------------------------------------------------------------------------

const SearchResultRow = memo(function SearchResultRow({
  result,
  isSelected,
  isNavigated,
  onNavigate,
}: {
  result: { id: string; title: string; score: number; excerpt: string; first_match_line?: number };
  isSelected: boolean;
  isNavigated: boolean;
  onNavigate: (id: string, line?: number) => void;
}) {
  const folder = result.id.includes("/")
    ? result.id.slice(0, result.id.lastIndexOf("/"))
    : "";

  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-active={isSelected || undefined}
      className={`cursor-pointer px-2 py-1.5 text-sm ${
        isNavigated
          ? "border-l-2 border-interactive-accent bg-bg-hover"
          : isSelected
            ? "bg-bg-hover"
            : "hover:bg-bg-hover"
      }`}
      onClick={() => onNavigate(result.id, result.first_match_line)}
    >
      <div className="flex items-center gap-1.5">
        <span className="truncate font-medium text-text-normal">{result.title}</span>
        {result.first_match_line != null && (
          <span className="shrink-0 rounded bg-bg-hover px-1 py-0.5 text-[10px] leading-none text-text-faint">
            :{result.first_match_line}
          </span>
        )}
      </div>
      {folder && (
        <div className="truncate text-xs text-text-faint" dir="rtl">
          {folder}
        </div>
      )}
      <div
        className="line-clamp-2 text-xs text-text-muted [&_mark]:rounded-sm [&_mark]:bg-text-highlight-bg [&_mark]:text-text-normal"
        dangerouslySetInnerHTML={{ __html: result.excerpt }}
      />
    </div>
  );
});

// ---------------------------------------------------------------------------
// TagInput (autocomplete multi-select)
// ---------------------------------------------------------------------------

function TagInput({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<TagSearchResult[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleInput = useCallback((value: string) => {
    setInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setSuggestions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchTags(value, 10);
        setSuggestions(results.filter((r) => !selected.includes(r.tag)));
      } catch {
        setSuggestions([]);
      }
    }, 200);
  }, [selected]);

  const addTag = useCallback((tag: string) => {
    if (!selected.includes(tag)) {
      onChange([...selected, tag]);
    }
    setInput("");
    setSuggestions([]);
  }, [selected, onChange]);

  const removeTag = useCallback((tag: string) => {
    onChange(selected.filter((t) => t !== tag));
  }, [selected, onChange]);

  return (
    <div className="flex flex-col gap-1">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-0.5 rounded-full bg-bg-hover px-2 py-0.5 text-xs text-text-muted"
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="ml-0.5 text-text-faint hover:text-text-normal"
                aria-label={`Remove tag ${tag}`}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => handleInput(e.target.value)}
          placeholder="Filter by tag..."
          className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-normal"
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions.length > 0) {
              e.preventDefault();
              // Don't let Enter bubble to the panel wrapper, which would
              // navigate to the selected search result.
              e.stopPropagation();
              addTag(suggestions[0]!.tag);
            }
          }}
        />
        {suggestions.length > 0 && (
          <div className="absolute inset-x-0 top-full z-10 mt-0.5 max-h-32 overflow-y-auto rounded border border-border bg-bg-primary shadow-lg">
            {suggestions.map((s) => (
              <button
                key={s.tag}
                type="button"
                className="block w-full px-2 py-1 text-start text-xs text-text-normal hover:bg-bg-hover"
                onClick={() => addTag(s.tag)}
              >
                {s.tag} <span className="text-text-faint">({s.count})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date helpers — epoch milliseconds (matching Rust indexer mtime)
// ---------------------------------------------------------------------------

/** Convert an epoch-millisecond timestamp to a YYYY-MM-DD date string. */
export function toDateString(epoch?: number): string {
  if (!epoch) return "";
  return new Date(epoch).toISOString().slice(0, 10);
}

/** Parse a YYYY-MM-DD date string into epoch milliseconds. */
export function fromDateString(s: string): number | undefined {
  if (!s) return undefined;
  return new Date(s).getTime();
}

/** Return epoch-ms timestamp for `daysAgo` days before `now` (epoch ms). */
export function presetMtimeAfter(daysAgo: number, now: number = Date.now()): number {
  return now - daysAgo * 86_400_000;
}

// ---------------------------------------------------------------------------
// DatePresets
// ---------------------------------------------------------------------------

function DateRangeFilter({
  mtimeAfter,
  mtimeBefore,
  onChange,
}: {
  mtimeAfter: number | undefined;
  mtimeBefore: number | undefined;
  onChange: (after?: number, before?: number) => void;
}) {
  const setPreset = (daysAgo: number) => {
    onChange(presetMtimeAfter(daysAgo), undefined);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setPreset(1)}
          className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted hover:text-text-normal"
        >
          Today
        </button>
        <button
          type="button"
          onClick={() => setPreset(7)}
          className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted hover:text-text-normal"
        >
          Week
        </button>
        <button
          type="button"
          onClick={() => setPreset(30)}
          className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted hover:text-text-normal"
        >
          Month
        </button>
      </div>
      <div className="flex gap-1">
        <input
          type="date"
          value={toDateString(mtimeAfter)}
          onChange={(e) => onChange(fromDateString(e.target.value), mtimeBefore)}
          className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-1 py-0.5 text-xs text-text-normal"
          aria-label="Modified after"
        />
        <input
          type="date"
          value={toDateString(mtimeBefore)}
          onChange={(e) => onChange(mtimeAfter, fromDateString(e.target.value))}
          className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-1 py-0.5 text-xs text-text-normal"
          aria-label="Modified before"
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActiveFilterChips
// ---------------------------------------------------------------------------

function ActiveFilterChips() {
  const filter = useSearchPanelStore((s) => s.filter);
  const setFilter = useSearchPanelStore((s) => s.setFilter);
  const clearFilter = useSearchPanelStore((s) => s.clearFilter);

  const chips: { key: string; label: string; onRemove: () => void }[] = [];

  if (filter.folder_prefix) {
    chips.push({
      key: "folder",
      label: `Folder: ${filter.folder_prefix}`,
      onRemove: () => setFilter({ folder_prefix: undefined }),
    });
  }

  if (filter.tags) {
    for (const tag of filter.tags) {
      chips.push({
        key: `tag:${tag}`,
        label: tag,
        onRemove: () => {
          const remaining = filter.tags!.filter((t) => t !== tag);
          setFilter({ tags: remaining.length ? remaining : undefined });
        },
      });
    }
  }

  if (filter.mtime_after || filter.mtime_before) {
    const parts: string[] = [];
    if (filter.mtime_after) parts.push(`after ${new Date(filter.mtime_after).toLocaleDateString()}`);
    if (filter.mtime_before) parts.push(`before ${new Date(filter.mtime_before).toLocaleDateString()}`);
    chips.push({
      key: "date",
      label: `Date: ${parts.join(", ")}`,
      onRemove: () => setFilter({ mtime_after: undefined, mtime_before: undefined }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1">
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-0.5 rounded-full bg-bg-hover px-2 py-0.5 text-xs text-text-muted"
        >
          {chip.label}
          <button
            type="button"
            onClick={chip.onRemove}
            className="ml-0.5 text-text-faint hover:text-text-normal"
            aria-label={`Remove ${chip.label}`}
          >
            x
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          onClick={clearFilter}
          className="text-xs text-text-accent hover:underline"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchPanel
// ---------------------------------------------------------------------------

export function SearchPanel({ isActive = true }: { isActive?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The panel stays mounted (keep-alive) while its sidebar tab is hidden.
  // Refs let the mount-once graph-updated listener see the current
  // visibility, deferring re-searches until the tab is shown again.
  const isActiveRef = useRef(isActive);
  const staleRef = useRef(false);

  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const query = useSearchPanelStore((s) => s.query);
  const filter = useSearchPanelStore((s) => s.filter);
  const results = useSearchPanelStore((s) => s.results);
  const selectedIndex = useSearchPanelStore((s) => s.selectedIndex);
  const isLoading = useSearchPanelStore((s) => s.isLoading);
  const totalCount = useSearchPanelStore((s) => s.totalCount);
  const setQuery = useSearchPanelStore((s) => s.setQuery);
  const setFilter = useSearchPanelStore((s) => s.setFilter);
  const selectNext = useSearchPanelStore((s) => s.selectNext);
  const selectPrev = useSearchPanelStore((s) => s.selectPrev);

  const [facetsExpanded, setFacetsExpanded] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);

  const navigatedResultId = useSearchPanelStore((s) => s.navigatedResultId);
  const setNavigatedResultId = useSearchPanelStore((s) => s.setNavigatedResultId);

  // Load folders on first expand
  useEffect(() => {
    if (facetsExpanded && !foldersLoaded) {
      listFolders()
        .then((f) => {
          setFolders(f);
          setFoldersLoaded(true);
        })
        .catch(console.error);
    }
  }, [facetsExpanded, foldersLoaded]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Listen for focus-search-panel event. Focus after a frame: the same event
  // also switches the sidebar tab, and the input can't take focus while its
  // container is still display:none.
  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    };
    window.addEventListener("lit:focus-search-panel", handler);
    return () => window.removeEventListener("lit:focus-search-panel", handler);
  }, []);

  // Re-run search when the graph index updates (file saved, created, deleted).
  // While the tab is hidden, just mark the results stale instead of running
  // ripgrep on every save; the activation effect below catches up.
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      if (!useWorkspaceStore.getState().graphReady) return;
      const { query: q } = useSearchPanelStore.getState();
      if (!q.trim()) return;
      if (!isActiveRef.current) {
        staleRef.current = true;
        return;
      }
      useSearchPanelStore.getState().executeSearch();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, []);

  // On tab activation, re-run a search that went stale while hidden.
  useEffect(() => {
    isActiveRef.current = isActive;
    if (!isActive || !staleRef.current) return;
    staleRef.current = false;
    if (!useWorkspaceStore.getState().graphReady) return;
    const { query: q } = useSearchPanelStore.getState();
    if (q.trim()) {
      useSearchPanelStore.getState().executeSearch();
    }
  }, [isActive]);

  // Re-run search when graphReady transitions from false → true
  // (e.g. after "Rebuild Graph Index" completes)
  const prevGraphReadyRef = useRef(graphReady);
  useEffect(() => {
    if (graphReady && !prevGraphReadyRef.current) {
      const { query: q } = useSearchPanelStore.getState();
      if (q.trim()) {
        useSearchPanelStore.getState().executeSearch();
      }
    }
    prevGraphReadyRef.current = graphReady;
  }, [graphReady]);

  const virtualizer = useVirtualizer({
    count: results.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  const navigateToResult = useCallback(
    (id: string, line?: number) => {
      navigateToNote(id, line ?? 1, { flash: true });
      setNavigatedResultId(`${id}:${line ?? 0}`);
    },
    [setNavigatedResultId],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        selectNext();
        const nextIdx = useSearchPanelStore.getState().selectedIndex;
        virtualizer.scrollToIndex(nextIdx, { align: "auto" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        selectPrev();
        const prevIdx = useSearchPanelStore.getState().selectedIndex;
        virtualizer.scrollToIndex(prevIdx, { align: "auto" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const idx = useSearchPanelStore.getState().selectedIndex;
        const result = results[idx];
        if (result) {
          navigateToResult(result.id, result.first_match_line);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (query) {
          setQuery("");
        } else {
          getCurrentEditorView()?.focus();
        }
      }
    },
    [results, query, selectNext, selectPrev, navigateToResult, setQuery, virtualizer],
  );

  const hasActiveFilters = !!(
    filter.folder_prefix ||
    (filter.tags && filter.tags.length > 0) ||
    filter.mtime_after ||
    filter.mtime_before
  );

  if (!graphReady) {
    return <IndexBuildingPlaceholder variant="inline" />;
  }

  return (
    <div
      ref={wrapperRef}
      className="flex h-full flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {/* Search input */}
      <div className="p-2">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search content..."
            className="w-full rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-normal"
            aria-label="Search content"
          />
          {isLoading && (
            <span
              role="status"
              aria-label="Searching"
              className="absolute right-2 top-1/2 -translate-y-1/2"
            >
              <SpinnerSvg className="h-3.5 w-3.5 text-text-faint" />
            </span>
          )}
        </div>
      </div>

      {/* Facet toggle */}
      <div className="px-2">
        <button
          type="button"
          onClick={() => setFacetsExpanded(!facetsExpanded)}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-text-normal"
          aria-expanded={facetsExpanded}
        >
          <span className="text-xs">{facetsExpanded ? "▾" : "▸"}</span>
          Filters
        </button>
      </div>

      {/* Facet bar */}
      {facetsExpanded && (
        <div className="flex flex-col gap-2 border-b border-border px-2 pb-2 pt-1">
          {/* Folder dropdown */}
          <label className="flex flex-col gap-0.5">
            <span className="text-xs text-text-faint">Folder</span>
            <select
              value={filter.folder_prefix ?? ""}
              onChange={(e) =>
                setFilter({ folder_prefix: e.target.value || undefined })
              }
              className="rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-normal"
            >
              <option value="">All folders</option>
              {folders.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          {/* Tag multi-select */}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-text-faint">Tags</span>
            <TagInput
              selected={filter.tags ?? []}
              onChange={(tags) =>
                setFilter({ tags: tags.length ? tags : undefined })
              }
            />
          </div>

          {/* Date range */}
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-text-faint">Modified</span>
            <DateRangeFilter
              mtimeAfter={filter.mtime_after}
              mtimeBefore={filter.mtime_before}
              onChange={(after, before) =>
                setFilter({ mtime_after: after, mtime_before: before })
              }
            />
          </div>
        </div>
      )}

      {/* Active filter chips */}
      <ActiveFilterChips />

      {/* Result count */}
      {query.trim() && (
        <div className="px-2 py-1 text-xs text-text-muted">
          {totalCount} result{totalCount !== 1 ? "s" : ""}
          {hasActiveFilters ? " (filtered)" : ""}
        </div>
      )}

      {/* Results / empty states */}
      {!query.trim() && results.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
          Type to search
        </div>
      ) : query.trim() && !isLoading && results.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-text-muted">
          <span>No results</span>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={() => useSearchPanelStore.getState().clearFilter()}
              className="text-xs text-text-accent hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          data-virtual-scroll
          className={`flex-1 overflow-y-auto overscroll-contain transition-opacity ${isLoading ? "opacity-60" : ""}`}
          role="listbox"
          aria-label="Search results"
          aria-busy={isLoading}
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const result = results[virtualRow.index];
              if (!result) return null;
              const resultKey = `${result.id}:${result.first_match_line ?? 0}`;
              return (
                <div
                  key={resultKey}
                  data-index={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <SearchResultRow
                    result={result}
                    isSelected={virtualRow.index === selectedIndex}
                    isNavigated={resultKey === navigatedResultId}
                    onNavigate={navigateToResult}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
