import { useEffect, useState, useCallback, useRef } from "react";
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
}

export function BacklinksPanel({ pageId, onCountChange }: BacklinksPanelProps) {
  const [entries, setEntries] = useState<BacklinkEntry[]>([]);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
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
    fetchBacklinks();
  }, [pageId, fetchBacklinks]);

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
    onCountChange?.(entries.length);
  }, [entries, onCountChange]);

  return (
    <div className="px-6 py-2">
      {entries.length === 0 ? (
        <p className="text-xs text-text-faint">
          No other pages link to this page
        </p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry, i) => (
            <li key={`${entry.source_id}-${i}`} className="text-xs">
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
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
