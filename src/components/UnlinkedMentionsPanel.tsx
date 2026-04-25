import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getUnlinkedMentions, linkUnlinkedMention, type UnlinkedMention } from "../lib/ipc";
import { useWorkspaceStore } from "../stores/workspace";

function highlightMention(context: string, matchedText: string): (string | JSX.Element)[] {
  const idx = context.toLowerCase().indexOf(matchedText.toLowerCase());
  if (idx === -1) return [context];
  return [
    context.slice(0, idx),
    <mark key="hl" className="bg-yellow-200/50 dark:bg-yellow-500/30">{context.slice(idx, idx + matchedText.length)}</mark>,
    context.slice(idx + matchedText.length),
  ];
}

export function UnlinkedMentionsPanel({ pageId }: { pageId: string }) {
  const [entries, setEntries] = useState<UnlinkedMention[]>([]);
  const [expanded, setExpanded] = useState(false);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const fetchMentions = useCallback(async () => {
    try {
      const result = await getUnlinkedMentions(pageIdRef.current);
      setEntries(result);
    } catch {
      setEntries([]);
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

  return (
    <div className="border-t border-border-faint px-6 py-3">
      <button
        data-testid="unlinked-header"
        className="flex w-full items-center gap-1 text-sm font-medium text-text-muted"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {entries.length > 0
          ? `Unlinked References (${entries.length})`
          : "Unlinked References"}
      </button>
      {expanded && (
        <div className="mt-2 max-h-64 overflow-y-auto">
          {entries.length === 0 ? (
            <p className="text-xs text-text-faint">
              No unlinked mentions found
            </p>
          ) : (
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
          )}
        </div>
      )}
    </div>
  );
}
