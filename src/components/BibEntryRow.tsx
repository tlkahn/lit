import { memo, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { getCitingPages, type BacklinkEntry, type BibEntry } from "../lib/ipc";
import { highlightWikilinks } from "../lib/highlightWikilinks";
import { useRecordDeparture } from "../hooks/useRecordDeparture";
import { doiHref } from "../lib/urlUtils";
import { distinctPublisher } from "../lib/bibUtils";
import { EntryTypeBadge } from "./EntryTypeBadge";
import { BibEntryActions, type BibEntryActionProps } from "./BibEntryActions";

export interface BibEntryRowProps {
  isExpanded: boolean;
  modHeld: boolean;
  onToggleExpand: (entryId: string) => void;
  onNavigateToBibFile: (entry: BibEntry) => void;
  actionProps: BibEntryActionProps;
}

function urlHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : "#";
}

function CitedBySection({ bibKey }: { bibKey: string }) {
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const currentPageRef = useRef(currentPagePath ?? "");
  currentPageRef.current = currentPagePath ?? "";
  const recordDeparture = useRecordDeparture(currentPageRef);
  const [citing, setCiting] = useState<BacklinkEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const bibKeyRef = useRef(bibKey);
  bibKeyRef.current = bibKey;

  const fetchCitingPages = useCallback(async () => {
    const capturedKey = bibKeyRef.current;
    try {
      const result = await getCitingPages(capturedKey);
      if (bibKeyRef.current !== capturedKey) return;
      setCiting(result);
    } catch {
      if (bibKeyRef.current !== capturedKey) return;
      setCiting([]);
    }
  }, []);

  useEffect(() => {
    if (graphReady) fetchCitingPages();
  }, [bibKey, graphReady, fetchCitingPages]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      fetchCitingPages();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [fetchCitingPages]);

  if (!graphReady || citing === null) return null;
  if (citing.length === 0) {
    return <div className="mt-2 text-xs text-text-faint">Not cited</div>;
  }
  return (
    <div className="mt-2" data-testid="cited-by-section">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
      >
        Cited by ({citing.length})
      </button>
      {open ? (
        <div className="mt-1">
          {citing.map((e, i) => (
            <div key={`${e.source_id}-${i}`} className="mt-1 text-xs">
              <button
                className="font-medium text-interactive-accent hover:underline"
                onClick={() => {
                  recordDeparture();
                  selectPageAtLine(e.source_id, e.source_line);
                }}
              >
                {e.source_title || e.source_id}
              </button>
              {e.context ? (
                <p
                  data-testid={`citing-context-${i}`}
                  className="mt-0.5 cursor-pointer text-text-muted hover:text-text-normal"
                  onClick={() => {
                    recordDeparture();
                    selectPageAtLine(e.source_id, e.source_line);
                  }}
                >
                  {highlightWikilinks(e.context)}
                  <span className="ml-1 text-text-faint">line {e.source_line}</span>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Renders a single bib entry: a collapsed row button (title, authors, year,
 * type badge) and, when expanded, a detail panel with full metadata,
 * {@link BibEntryActions}, and the cited-by list.
 *
 * Content-only: the parent owns the virtualizer wrapper div, indicator classes,
 * `data-indicator`, and the reveal flash. Callbacks are pre-wired by the parent
 * (e.g. note/markdown opens already include `recordDeparture()`).
 */
function areEqual(prev: BibEntryRowProps, next: BibEntryRowProps): boolean {
  if (prev.isExpanded !== next.isExpanded) return false;
  if (prev.modHeld !== next.modHeld) return false;
  if (prev.onToggleExpand !== next.onToggleExpand) return false;
  if (prev.onNavigateToBibFile !== next.onNavigateToBibFile) return false;
  const pa = prev.actionProps as unknown as Record<string, unknown>;
  const na = next.actionProps as unknown as Record<string, unknown>;
  const keys = Object.keys(pa);
  if (keys.length !== Object.keys(na).length) return false;
  for (const k of keys) {
    if (pa[k] !== na[k]) return false;
  }
  return true;
}

export const BibEntryRow = memo(function BibEntryRow(props: BibEntryRowProps) {
  const { isExpanded, modHeld, onToggleExpand, onNavigateToBibFile, actionProps } = props;
  const { entry } = actionProps;

  const entryId = `${entry.bib_file ?? ""}:${entry.key}`;
  const tags = entry.tags ?? [];

  return (
    <>
      <button
        onClick={() => onToggleExpand(entryId)}
        className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded px-2 py-1 text-start hover:bg-bg-hover"
      >
        <span
          data-testid="reference-entry-title"
          className={`w-full truncate text-xs ${modHeld && entry.bib_file ? "cursor-pointer underline text-interactive-accent" : "text-text-normal"}`}
          onClick={(e) => {
            if ((e.metaKey || e.ctrlKey) && entry.bib_file) {
              e.stopPropagation();
              onNavigateToBibFile(entry);
            }
          }}
        >
          {entry.title}
        </span>
        <span className="flex w-full items-center gap-1 text-xs text-text-muted">
          <span className="truncate">
            {entry.authors.join("; ")}
            {entry.year ? ` (${entry.year})` : ""}
          </span>
          <EntryTypeBadge entryType={entry.entry_type} className="shrink-0" />
        </span>
      </button>
      {isExpanded ? (
        <div className="mt-1 rounded border border-border bg-bg-primary px-2 py-2 font-serif italic text-xs">
          <div className="flex items-start gap-2">
            <div
              className={`font-semibold ${modHeld && entry.bib_file ? "cursor-pointer underline text-interactive-accent" : "text-text-normal"}`}
              onClick={(e) => {
                if ((e.metaKey || e.ctrlKey) && entry.bib_file) {
                  onNavigateToBibFile(entry);
                }
              }}
            >
              {entry.title}
            </div>
            <EntryTypeBadge entryType={entry.entry_type} className="shrink-0" />
          </div>
          {entry.authors.length > 0 ? (
            <div className="mt-1 text-text-muted">
              {entry.authors.join("; ")}
            </div>
          ) : null}
          {entry.editors && entry.editors.length > 0 ? (
            <div data-testid="entry-editors" className="text-text-muted">
              Ed. {entry.editors.join("; ")}
            </div>
          ) : null}
          {entry.year ? (
            <div className="text-text-muted">{entry.year}</div>
          ) : null}
          {entry.journal ? (
            <div className="text-text-muted">{entry.journal}</div>
          ) : null}
          {distinctPublisher(entry) ? (
            <div data-testid="entry-publisher" className="text-text-muted">{distinctPublisher(entry)}</div>
          ) : null}
          {entry.isbn ? (
            <div data-testid="entry-isbn" className="text-text-muted">
              ISBN:{" "}
              <a
                href={`https://openlibrary.org/isbn/${entry.isbn}`}
                target="_blank"
                rel="noreferrer"
                className="text-interactive-accent hover:underline"
              >
                {entry.isbn}
              </a>
            </div>
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
                href={urlHref(entry.url)}
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
              {tags.map((t, i) => (
                <span
                  key={`${t}-${i}`}
                  className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted"
                >
                  {t}
                </span>
              ))}
            </div>
          ) : null}
          <div className="not-italic">
            <BibEntryActions {...actionProps} />
            <CitedBySection bibKey={entry.key} />
          </div>
        </div>
      ) : null}
    </>
  );
}, areEqual);
