import { useEffect, useState, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { getBacklinks, type BacklinkEntry } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { highlightWikilinks } from "../lib/highlightWikilinks";
import { useRecordDeparture } from "../hooks/useRecordDeparture";

interface BacklinksPanelProps {
  pageId: string;
  onCountChange?: (count: number) => void;
  contentHeight?: number;
  active?: boolean;
}

export function BacklinksPanel({ pageId, onCountChange, contentHeight, active = true }: BacklinksPanelProps) {
  const [entries, setEntries] = useState<BacklinkEntry[]>([]);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;
  const activeRef = useRef(active);
  activeRef.current = active;
  const staleRef = useRef(false);

  const recordDeparture = useRecordDeparture(pageIdRef);

  const fetchBacklinks = useCallback(async () => {
    const capturedId = pageIdRef.current;
    try {
      const result = await getBacklinks(capturedId);
      if (pageIdRef.current !== capturedId) return;
      setEntries(result);
    } catch (err) {
      if (pageIdRef.current !== capturedId) return;
      console.warn("Failed to fetch backlinks:", err);
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    if (graphReady) fetchBacklinks();
  }, [pageId, graphReady, fetchBacklinks]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      if (activeRef.current) {
        fetchBacklinks();
      } else {
        staleRef.current = true;
      }
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [fetchBacklinks]);

  useEffect(() => {
    if (active && staleRef.current) {
      staleRef.current = false;
      fetchBacklinks();
    }
  }, [active, fetchBacklinks]);

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
      <div className="px-4 py-2" data-testid="backlinks-building">
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
          No other pages link to this page
        </p>
      ) : (
        <div
          ref={scrollRef}
          data-testid="backlinks-scroll-container"
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
                  <button
                    className="font-medium text-interactive-accent hover:underline"
                    onClick={() => {
                      recordDeparture();
                      selectPage(entry.source_id);
                    }}
                  >
                    {entry.source_title || entry.source_id}
                  </button>
                  {entry.context && (
                    <p
                      data-testid={`backlink-context-${i}`}
                      className="mt-0.5 cursor-pointer text-text-muted hover:text-text-normal"
                      onClick={() => {
                        recordDeparture();
                        selectPageAtLine(entry.source_id, entry.source_line);
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
