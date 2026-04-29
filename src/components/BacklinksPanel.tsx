import { useEffect, useState, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { getBacklinks, type BacklinkEntry } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { globalJumpTracker } from "../editor/jumpTracker";

function highlightWikilinks(text: string): (string | JSX.Element)[] {
  const parts: (string | JSX.Element)[] = [];
  const regex = /\[\[[^\]]+\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(
      <span key={key++} className="text-interactive-accent font-medium">
        {match[0]}
      </span>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

interface BacklinksPanelProps {
  pageId: string;
  onCountChange?: (count: number) => void;
  contentHeight?: number;
}

export function BacklinksPanel({ pageId, onCountChange, contentHeight }: BacklinksPanelProps) {
  const [entries, setEntries] = useState<BacklinkEntry[]>([]);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const recordDeparture = useCallback(() => {
    const view = getCurrentEditorView();
    const notePath = pageIdRef.current;
    if (!view || !notePath) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    globalJumpTracker.recordJump(
      { notePath, line: line.number, col: head - line.from },
      { notePath: "", line: 0, col: 0 },
    );
  }, []);

  const fetchBacklinks = useCallback(async () => {
    try {
      const result = await getBacklinks(pageIdRef.current);
      setEntries(result);
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    if (graphReady) fetchBacklinks();
  }, [pageId, graphReady, fetchBacklinks]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      fetchBacklinks();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [fetchBacklinks]);

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
      <div className="px-6 py-2" data-testid="backlinks-building">
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
    <div className="px-6 py-2">
      {entries.length === 0 ? (
        <p className="text-xs text-text-faint">
          No other pages link to this page
        </p>
      ) : (
        <div
          ref={scrollRef}
          data-testid="backlinks-scroll-container"
          data-virtual-scroll
          className="overflow-y-auto"
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
