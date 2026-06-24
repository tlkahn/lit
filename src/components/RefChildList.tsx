import { useCallback, useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getReferences, type BibEntry, type BibKeyState } from "../lib/ipc";
import { BibEntryRow } from "./BibEntryRow";
import type { BibEntryActionProps } from "./BibEntryActions";

export interface RefChildListProps {
  parentKey: string;
  parentTitle: string;
  paneId: string;
  workspacePath: string;
  refCounts: Record<string, number>;
  bibKeyStates: Record<string, BibKeyState>;
  modHeld: boolean;
  onDrillDown: (entry: BibEntry) => void;
  onBack: () => void;
  onNavigateToBibFile: (entry: BibEntry) => void;
  onOpenNote: (pageId: string) => void;
  onCreateNote: (key: string) => void;
  onEnrich: (entry: BibEntry) => void;
  onOpenPdf: (file: string) => void;
  onOpenMarkdown: (filename: string) => void;
  onOcr: (entry: BibEntry) => void;
  onCopyCitation: (key: string) => void;
  onDownloadPdf: (entry: BibEntry) => void;
  onLinkPdf: (entry: BibEntry) => void;
}

export function RefChildList(props: RefChildListProps) {
  const {
    parentKey,
    parentTitle,
    workspacePath,
    refCounts,
    bibKeyStates,
    modHeld,
    onDrillDown,
    onBack,
    onNavigateToBibFile,
    onOpenNote,
    onCreateNote,
    onEnrich,
    onOpenPdf,
    onOpenMarkdown,
    onOcr,
    onCopyCitation,
    onDownloadPdf,
    onLinkPdf,
  } = props;

  const [children, setChildren] = useState<BibEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setLoading(true);
    setExpandedKey(null);
    const id = ++requestIdRef.current;
    getReferences(parentKey, workspacePath)
      .then((result) => {
        if (id === requestIdRef.current) {
          setChildren(result);
          setLoading(false);
        }
      })
      .catch(() => {
        if (id === requestIdRef.current) {
          setChildren([]);
          setLoading(false);
        }
      });
  }, [parentKey, workspacePath]);

  const toggleExpand = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const expandedIndex = children.findIndex(
    (e) => `${e.bib_file ?? ""}:${e.key}` === expandedKey,
  );

  const virtualizer = useVirtualizer({
    count: children.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      if (index === expandedIndex) return 260;
      return 48;
    },
    overscan: 10,
  });

  const prevExpandedRef = useRef(expandedIndex);
  useEffect(() => {
    const prev = prevExpandedRef.current;
    prevExpandedRef.current = expandedIndex;
    const changed: number[] = [];
    if (prev >= 0) changed.push(prev);
    if (expandedIndex >= 0 && expandedIndex !== prev) changed.push(expandedIndex);
    for (const idx of changed) {
      virtualizer.resizeItem(idx, virtualizer.options.estimateSize(idx));
    }
  }, [virtualizer, expandedIndex]);

  const truncatedTitle =
    parentTitle.length > 30
      ? parentTitle.slice(0, 30) + "…"
      : parentTitle;

  const virtualItems = virtualizer.getVirtualItems();

  const makeActionProps = useCallback(
    (entry: BibEntry): BibEntryActionProps => ({
      entry,
      state: bibKeyStates[entry.key],
      ocrCompanionCurrent: undefined,
      isMaterializing: false,
      isEnriching: false,
      enrichPhase: "fetch",
      isDownloading: false,
      downloadProgress: null,
      isLinking: false,
      onOpenNote,
      onCreateNote,
      onEnrich,
      onOpenPdf,
      onOpenMarkdown,
      onOcr,
      onCopyCitation,
      onDownloadPdf,
      onLinkPdf,
    }),
    [bibKeyStates, onOpenNote, onCreateNote, onEnrich, onOpenPdf, onOpenMarkdown, onOcr, onCopyCitation, onDownloadPdf, onLinkPdf],
  );

  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-1 px-2 py-1">
          <button
            onClick={onBack}
            className="shrink-0 rounded px-1 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
          >
            ‹ Back
          </button>
          <span className="truncate text-xs font-medium text-text-normal">{truncatedTitle}</span>
        </div>
        <div className="flex flex-1 items-center justify-center text-xs text-text-faint">
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          data-testid="ref-child-back-btn"
          onClick={onBack}
          className="shrink-0 rounded px-1 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
        >
          ‹ Back
        </button>
        <span className="truncate text-xs font-medium text-text-normal">{truncatedTitle}</span>
      </div>
      {children.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-text-faint">
          No references
        </div>
      ) : (
        <div
          ref={scrollRef}
          data-testid="ref-child-list"
          data-virtual-scroll
          className="flex-1 overflow-y-auto overscroll-contain px-1"
        >
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualItems.map((virtualRow) => {
              const entry = children[virtualRow.index];
              if (!entry) return null;
              const entryId = `${entry.bib_file ?? ""}:${entry.key}`;
              const isExpanded = expandedKey === entryId;
              const state = bibKeyStates[entry.key];
              return (
                <div
                  key={entryId}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  className={
                    state?.page_id
                      ? "border-l-2 border-interactive-accent"
                      : state?.materialization === "partial"
                        ? "border-l-2 border-dashed border-text-muted"
                        : undefined
                  }
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <BibEntryRow
                    isExpanded={isExpanded}
                    modHeld={modHeld}
                    onToggleExpand={toggleExpand}
                    onNavigateToBibFile={onNavigateToBibFile}
                    actionProps={makeActionProps(entry)}
                    referenceCount={refCounts[entry.key]}
                    onDrillDown={onDrillDown}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
