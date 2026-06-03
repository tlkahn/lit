import { useEffect, useState, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { getForwardLinks, type LinkEntry } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { highlightWikilinks } from "../lib/highlightWikilinks";
import { useRecordDeparture } from "../hooks/useRecordDeparture";

interface OutgoingLinksPanelProps {
  pageId: string;
  onCountChange?: (count: number) => void;
  contentHeight?: number;
  active?: boolean;
}

export function OutgoingLinksPanel({ pageId, onCountChange, contentHeight, active = true }: OutgoingLinksPanelProps) {
  const [entries, setEntries] = useState<LinkEntry[]>([]);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;
  const activeRef = useRef(active);
  activeRef.current = active;
  const staleRef = useRef(false);

  const recordDeparture = useRecordDeparture(pageIdRef);

  const fetchForwardLinks = useCallback(async () => {
    const capturedId = pageIdRef.current;
    try {
      const result = await getForwardLinks(capturedId);
      if (pageIdRef.current !== capturedId) return;
      setEntries(result);
    } catch (err) {
      if (pageIdRef.current !== capturedId) return;
      console.warn("Failed to fetch outgoing links:", err);
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    if (graphReady) fetchForwardLinks();
  }, [pageId, graphReady, fetchForwardLinks]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      if (activeRef.current) {
        fetchForwardLinks();
      } else {
        staleRef.current = true;
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [fetchForwardLinks]);

  useEffect(() => {
    if (active && staleRef.current) {
      staleRef.current = false;
      fetchForwardLinks();
    }
  }, [active, fetchForwardLinks]);

  useEffect(() => {
    if (graphReady) onCountChange?.(entries.length);
  }, [entries, graphReady, onCountChange]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
  });

  if (!graphReady) {
    return (
      <div className="px-4 py-2" data-testid="outgoing-building">
        <div className="flex items-center gap-2 py-1">
          <svg
            className="h-3 w-3 animate-spin text-text-faint"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs text-text-faint">Building index...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col px-4 py-2">
      {entries.length === 0 ? (
        <p className="text-xs text-text-faint">
          This page does not link to any other pages
        </p>
      ) : (
        <div
          ref={scrollRef}
          data-testid="outgoing-scroll-container"
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
                  key={`${entry.target_id}-${i}`}
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
                  <button
                    className="font-medium text-interactive-accent hover:underline"
                    onClick={() => {
                      recordDeparture();
                      selectPage(entry.target_id);
                    }}
                  >
                    {entry.target_title || entry.target_id}
                  </button>
                  {entry.context && (
                    <p
                      data-testid={`outgoing-context-${i}`}
                      className="mt-0.5 cursor-pointer text-text-muted hover:text-text-normal"
                      onClick={() => {
                        recordDeparture();
                        selectPage(entry.target_id);
                      }}
                    >
                      {highlightWikilinks(entry.context)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
