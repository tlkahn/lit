import {
  useEffect,
  useState,
  useMemo,
  useRef,
  useDeferredValue,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import { listBibEntries, type BibEntry } from "../lib/ipc";
import { localeFilter } from "../lib/localeSearch";

function lastName(entry: BibEntry): string {
  const first = entry.authors[0] ?? "";
  const comma = first.indexOf(",");
  const name = comma >= 0 ? first.slice(0, comma).trim() : first.trim();
  return name || first;
}

function combinedText(entry: BibEntry): string {
  return [
    entry.key,
    entry.title,
    entry.authors.join(" "),
    (entry.tags ?? []).join(" "),
    entry.journal ?? "",
  ].join(" ");
}

function doiHref(doi: string): string {
  return /^https?:\/\//i.test(doi) ? doi : `https://doi.org/${doi}`;
}

export function ReferenceLibrary() {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const show = useStatusMessageStore((s) => s.show);
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  useEffect(() => {
    if (!workspacePath) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    listBibEntries(workspacePath)
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const byName = lastName(a).localeCompare(lastName(b), undefined, {
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
      return (a.year ?? "").localeCompare(b.year ?? "");
    });
  }, [entries]);

  const filtered = useMemo(
    () => localeFilter(sorted, deferredSearch, combinedText),
    [sorted, deferredSearch],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const copyCitation = useCallback(
    (key: string) => {
      navigator.clipboard
        .writeText(`[@${key}]`)
        .then(() => show(`Copied [@${key}]`))
        .catch(() => show("Failed to copy citation", "error"));
    },
    [show],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const expandedIndex = useMemo(
    () => filtered.findIndex((e) => e.key === expandedKey),
    [filtered, expandedKey],
  );
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (index === expandedIndex ? 260 : 36),
    overscan: 10,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, expandedIndex]);

  if (entries.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-text-faint">
        No references found. Add .bib files to your workspace.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="p-2">
        <input
          type="text"
          placeholder="Search references…"
          aria-label="Search references"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="min-w-0 w-full rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-normal"
        />
      </div>
      <div
        ref={scrollRef}
        data-testid="reference-library-list"
        data-virtual-scroll
        className="flex-1 overflow-y-auto overscroll-contain px-1"
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const entry = filtered[virtualRow.index]!;
            const isExpanded = expandedKey === entry.key;
            const tags = entry.tags ?? [];
            return (
              <div
                key={entry.key}
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
                <button
                  onClick={() => toggleExpand(entry.key)}
                  className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded px-2 py-1 text-start hover:bg-bg-hover"
                >
                  <span
                    data-testid="reference-entry-title"
                    className="w-full truncate text-sm text-text-normal"
                  >
                    {entry.title}
                  </span>
                  <span className="w-full truncate text-xs text-text-muted">
                    {entry.authors.join("; ")}
                    {entry.year ? ` (${entry.year})` : ""}
                  </span>
                </button>
                {isExpanded ? (
                  <div className="mt-1 rounded border border-border bg-bg-primary px-2 py-2 text-sm">
                    <div className="font-semibold text-text-normal">{entry.title}</div>
                    {entry.authors.length > 0 ? (
                      <div className="mt-1 text-text-muted">
                        {entry.authors.join("; ")}
                      </div>
                    ) : null}
                    {entry.year ? (
                      <div className="text-text-muted">{entry.year}</div>
                    ) : null}
                    {entry.journal ? (
                      <div className="text-text-muted">{entry.journal}</div>
                    ) : null}
                    {entry.doi ? (
                      <div className="mt-1">
                        <a
                          href={doiHref(entry.doi)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-interactive-accent hover:underline"
                        >
                          {entry.doi}
                        </a>
                      </div>
                    ) : null}
                    {entry.url ? (
                      <div className="mt-1">
                        <a
                          href={entry.url}
                          target="_blank"
                          rel="noreferrer"
                          className="break-all text-interactive-accent hover:underline"
                        >
                          {entry.url}
                        </a>
                      </div>
                    ) : null}
                    {entry.abstract_text ? (
                      <p className="mt-2 text-text-normal">{entry.abstract_text}</p>
                    ) : null}
                    {tags.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {tags.map((t) => (
                          <span
                            key={t}
                            className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-2">
                      <button
                        onClick={() => copyCitation(entry.key)}
                        className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
                      >
                        Copy citation
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
