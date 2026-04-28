import { useEffect, useState, useCallback, useRef } from "react";
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
}

export function UnlinkedMentionsPanel({ pageId, onCountChange }: UnlinkedMentionsPanelProps) {
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

  return (
    <div className="px-6 py-2">
      {loading && entries.length === 0 ? (
        <div className="flex justify-center py-2">
          <svg
            data-testid="unlinked-spinner"
            className="h-4 w-4 animate-spin text-text-faint"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-text-faint">
          No unlinked mentions found
        </p>
      ) : (
        <>
          {loading && (
            <div className="flex justify-center py-1">
              <svg
                data-testid="unlinked-spinner"
                className="h-3 w-3 animate-spin text-text-faint"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          <ul className="space-y-2">
            {entries.map((entry, i) => (
              <li key={`${entry.source_id}-${i}`} className="text-xs">
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
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
