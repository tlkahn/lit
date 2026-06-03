import { useEffect, useState, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { getUnlinkedMentions, linkUnlinkedMention, type UnlinkedMention } from "../lib/ipc";
import { localeIndexOf } from "../lib/localeSearch";
import { useWorkspaceStore } from "../stores/workspace";

function highlightMention(context: string, matchedText: string): (string | JSX.Element)[] {
  const match = localeIndexOf(context, matchedText);
  if (!match) return [context];
  return [
    context.slice(0, match.start),
    <mark key="hl" className="bg-yellow-200/50 dark:bg-yellow-500/30">{context.slice(match.start, match.end)}</mark>,
    context.slice(match.end),
  ];
}

interface UnlinkedMentionsPanelProps {
  pageId: string;
  onCountChange?: (count: number) => void;
  contentHeight?: number;
  active?: boolean;
}

export function UnlinkedMentionsPanel({ pageId, onCountChange, contentHeight, active = true }: UnlinkedMentionsPanelProps) {
  const [entries, setEntries] = useState<UnlinkedMention[]>([]);
  const [loading, setLoading] = useState(true);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;
  const activeRef = useRef(active);
  activeRef.current = active;
  const staleRef = useRef(false);

  const fetchMentions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUnlinkedMentions(pageIdRef.current);
      setEntries(result);
    } catch (err) {
      console.warn("Failed to fetch unlinked mentions:", err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMentions();
  }, [pageId, fetchMentions]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      if (activeRef.current) {
        fetchMentions();
      } else {
        staleRef.current = true;
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [fetchMentions]);

  useEffect(() => {
    if (active && staleRef.current) {
      staleRef.current = false;
      fetchMentions();
    }
  }, [active, fetchMentions]);

  useEffect(() => {
    if (!loading) {
      onCountChange?.(entries.length);
    }
  }, [entries, loading, onCountChange]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
  });

  const spinner = (size: string) => (
    <div className={`flex justify-center ${size === "lg" ? "py-2" : "py-1"}`}>
      <svg
        data-testid="unlinked-spinner"
        className={`${size === "lg" ? "h-4 w-4" : "h-3 w-3"} animate-spin text-text-faint`}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
    </div>
  );

  return (
    <div className="flex h-full flex-col px-4 py-2">
      {loading && entries.length === 0 ? (
        spinner("lg")
      ) : entries.length === 0 ? (
        <p className="text-xs text-text-faint">
          No unlinked mentions found
        </p>
      ) : (
        <>
          {loading && spinner("sm")}
          <div
            ref={scrollRef}
            data-testid="unlinked-scroll-container"
            data-virtual-scroll
            className={`overflow-y-auto${contentHeight == null ? " min-h-0 flex-1" : ""}`}
            style={contentHeight != null ? { height: contentHeight } : undefined}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const i = virtualRow.index;
                const entry = entries[i]!;
                return (
                  <div
                    key={`${entry.source_id}-${i}`}
                    ref={virtualizer.measureElement}
                    data-index={i}
                    className="text-xs"
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                      paddingBottom: 8,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <button
                        className="font-medium text-interactive-accent hover:underline"
                        onClick={() => selectPage(entry.source_id)}
                      >
                        {entry.source_title || entry.source_id}
                      </button>
                      <button
                        className="text-xs text-interactive-accent hover:underline"
                        onClick={async () => {
                          await linkUnlinkedMention(entry.source_id, entry.source_line, entry.matched_text);
                          fetchMentions();
                        }}
                      >
                        Link
                      </button>
                    </div>
                    {entry.context && (
                      <p
                        data-testid={`unlinked-context-${i}`}
                        className="mt-0.5 text-text-muted"
                      >
                        {highlightMention(entry.context, entry.matched_text)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
