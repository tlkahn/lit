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
}

export function UnlinkedMentionsPanel({ pageId, onCountChange, contentHeight }: UnlinkedMentionsPanelProps) {
  const [entries, setEntries] = useState<UnlinkedMention[]>([]);
  const [loading, setLoading] = useState(true);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const fetchMentions = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getUnlinkedMentions(pageIdRef.current);
      setEntries(result);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMentions();
  }, [pageId, fetchMentions]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      fetchMentions();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [fetchMentions]);

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
      <span
        data-testid="unlinked-spinner"
        className={`nerd-font inline-block ${size === "lg" ? "text-base" : "text-xs"} animate-spin text-text-faint`}
      >{''}</span>
    </div>
  );

  return (
    <div className="px-6 py-2">
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
