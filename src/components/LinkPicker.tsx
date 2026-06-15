import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TYPE_ICON, truncateBody } from "../editor/livePreview/annotationConstants";
import type { CardboxAnnotation, AnnotationType } from "../lib/ipc";

interface LinkPickerProps {
  open: boolean;
  sourceUuid: string;
  annotations: CardboxAnnotation[];
  existingLinks: string[];
  onSelect: (targetUuid: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

export function LinkPicker({
  open,
  sourceUuid,
  annotations,
  existingLinks,
  onSelect,
  onClose,
}: LinkPickerProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // Build excluded set once per render for O(1) lookups
  const excludedSet = useMemo(() => {
    const set = new Set(existingLinks);
    set.add(sourceUuid);
    return set;
  }, [sourceUuid, existingLinks]);

  // Filter candidates
  const filtered = useMemo(() => {
    const candidates = annotations.filter((a) => !excludedSet.has(a.uuid));

    if (!query) {
      return candidates.slice(0, MAX_RESULTS);
    }

    const lower = query.toLowerCase();
    return candidates
      .filter((a) => {
        const body = a.body?.toLowerCase() ?? "";
        const original = a.original?.toLowerCase() ?? "";
        const title = a.source_page_title.toLowerCase();
        return body.includes(lower) || original.includes(lower) || title.includes(lower);
      })
      .slice(0, MAX_RESULTS);
  }, [annotations, excludedSet, query]);

  const totalItems = filtered.length;

  // Scroll active item into view
  useEffect(() => {
    if (totalItems === 0) return;
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, totalItems]);

  const handleSelect = useCallback(
    (uuid: string) => {
      onSelect(uuid);
      onClose();
    },
    [onSelect, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (totalItems > 0) {
          setActiveIndex((prev) => (prev + 1) % totalItems);
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (totalItems > 0) {
          setActiveIndex((prev) => (prev - 1 + totalItems) % totalItems);
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[activeIndex]) {
          handleSelect(filtered[activeIndex].uuid);
        }
      }
    },
    [filtered, activeIndex, totalItems, handleSelect, onClose],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setActiveIndex(0);
  }, []);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]"
      data-testid="link-picker-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[60vh] w-[560px] flex-col overflow-hidden rounded-lg bg-bg-primary shadow-lg"
        data-testid="link-picker-panel"
      >
        <div className="flex items-center border-b border-bg-hover">
          <input
            ref={inputRef}
            className="w-full bg-bg-primary px-4 py-3 text-text-normal outline-none"
            data-testid="link-picker-input"
            placeholder="Link to…"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
        </div>

        <div ref={listRef} className="flex-1 overflow-y-auto">
          {totalItems === 0 && query && (
            <div className="px-4 py-3 text-sm text-text-muted">No results</div>
          )}

          {totalItems === 0 && !query && (
            <div className="px-4 py-3 text-sm text-text-muted">No candidates available</div>
          )}

          {filtered.map((annotation, i) => {
            const icon = TYPE_ICON[annotation.annotation_type as AnnotationType] ?? "?";
            return (
              <div
                key={annotation.uuid}
                data-testid="link-picker-result"
                data-active={i === activeIndex ? "true" : "false"}
                className={`cursor-pointer px-4 py-2 text-sm ${i === activeIndex ? "bg-bg-hover" : ""}`}
                onClick={() => handleSelect(annotation.uuid)}
              >
                <div className="flex items-center gap-2">
                  <span className="nerd-font inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-hover text-xs font-medium text-text-accent">
                    {icon}
                  </span>
                  <span className="font-medium text-text-normal truncate">
                    {truncateBody(annotation.body ?? annotation.original, 60)}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-text-muted">
                    {annotation.source_page_title}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
