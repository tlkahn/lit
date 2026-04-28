import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { Heading } from "../lib/headings";
import { fuzzyMatch } from "../lib/fuzzyMatch";

interface HeadingQuickSwitcherProps {
  open: boolean;
  onClose: () => void;
  onSelect: (line: number) => void;
  headings: Heading[];
}

interface FilteredHeading {
  heading: Heading;
  indices: number[];
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  if (indices.length === 0) return <>{text}</>;

  const indexSet = new Set(indices);
  const parts: { text: string; highlighted: boolean }[] = [];
  let current = "";
  let inHighlight = false;

  let gi = 0;
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const shouldHighlight = indexSet.has(gi);
    if (shouldHighlight !== inHighlight) {
      if (current) parts.push({ text: current, highlighted: inHighlight });
      current = "";
      inHighlight = shouldHighlight;
    }
    current += segment;
    gi++;
  }
  if (current) parts.push({ text: current, highlighted: inHighlight });

  return (
    <>
      {parts.map((part, i) =>
        part.highlighted ? (
          <mark key={i} className="bg-transparent font-semibold text-text-accent">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function HeadingQuickSwitcher({ open, onClose, onSelect, headings }: HeadingQuickSwitcherProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo((): FilteredHeading[] => {
    if (!query) return headings.map((h) => ({ heading: h, indices: [] }));
    const results: FilteredHeading[] = [];
    for (const heading of headings) {
      const match = fuzzyMatch(query, heading.text);
      if (match) results.push({ heading, indices: match.indices });
    }
    return results;
  }, [query, headings]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open || filtered.length === 0) return;
    const activeEl = listRef.current?.querySelector('[data-active="true"]');
    if (activeEl && typeof activeEl.scrollIntoView === "function") {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open, filtered.length]);

  const selectCurrent = useCallback(() => {
    if (filtered.length > 0) {
      onSelect(filtered[activeIndex]!.heading.line);
      onClose();
    }
  }, [filtered, activeIndex, onSelect, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        selectCurrent();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [filtered.length, selectCurrent, onClose],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[20vh]"
      data-testid="quick-switcher-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex max-h-[60vh] w-[500px] flex-col overflow-hidden rounded-lg bg-bg-primary shadow-lg"
        data-testid="quick-switcher-panel"
      >
        <input
          ref={inputRef}
          className="w-full border-b border-bg-hover bg-bg-primary px-4 py-3 text-text-normal outline-none"
          data-testid="quick-switcher-input"
          placeholder="Go to heading…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {headings.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">No headings</div>
          ) : filtered.length === 0 ? (
            <div className="px-4 py-3 text-sm text-text-muted">No matches</div>
          ) : (
            filtered.map((item, i) => (
              <div
                key={`${item.heading.line}-${item.heading.text}`}
                data-testid="quick-switcher-item"
                data-active={i === activeIndex ? "true" : "false"}
                className={`cursor-pointer px-4 py-1.5 text-sm ${i === activeIndex ? "bg-bg-hover" : ""}`}
                style={{ paddingInlineStart: `${(item.heading.level - 1) * 12 + 16}px` }}
                onClick={() => {
                  onSelect(item.heading.line);
                  onClose();
                }}
              >
                <HighlightedText text={item.heading.text} indices={item.indices} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
