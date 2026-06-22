import {
  useEffect,
  useLayoutEffect,
  useState,
  useMemo,
  useRef,
  useDeferredValue,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { SegmentedControl } from "./SegmentedControl";
import { PaperSearchResults } from "./PaperSearchResults";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import {
  listBibEntries,
  getCitingPages,
  getBibKeyStates,
  enrichBibEntry,
  applyEnrichmentCandidate,
  downloadEntryPdf,
  linkEntryPdf,
  searchPapers,
  saveBibEntry,
  isSaved,
  isSavedNoDoi,
  isDuplicateDoi,
  isOcrCompanionCurrent,
  type BibEntry,
  type BibKeyState,
  type BacklinkEntry,
  type FileEvent,
  type PaperSearchResult,
} from "../lib/ipc";
import { classifyEnrichResult, dispatchEnrichResult, type EnrichCandidateState } from "../lib/enrichResult";
import { ensureSidebarVisible } from "../lib/sidebarVisibility";
import {
  onRevealBibEntry,
  onRevealBibEntryForPage,
  dispatchSetSidebarTab,
} from "../lib/sidebarEvents";
import { useMaterializeCitation } from "../hooks/useMaterializeCitation";
import { useDropPdf } from "../hooks/useDropPdf";
import { useRevealFlash } from "../hooks/useRevealFlash";
import { localeFilter } from "../lib/localeSearch";
import { AddReferenceDialog } from "./AddReferenceDialog";
import { ImportPdfDialog } from "./ImportPdfDialog";
import { OcrDialog } from "./OcrDialog";
import { highlightWikilinks } from "../lib/highlightWikilinks";
import { useRecordDeparture } from "../hooks/useRecordDeparture";
import { useModKeyHeld } from "../hooks/useModKeyHeld";
import { doiHref } from "../lib/urlUtils";
import { lastName, initialOf, buildSectionedList } from "../lib/sectionedList";
import { AlphabetStrip } from "./AlphabetStrip";
import { EntryTypeBadge } from "./EntryTypeBadge";
import { EnrichCandidatePicker } from "./EnrichCandidatePicker";
import { BibEntryActions } from "./BibEntryActions";
import { distinctPublisher } from "../lib/bibUtils";

/**
 * Check whether an entry's absolute bib_file path ends with the given
 * workspace-relative bibFile from the event. Uses a path-separator boundary
 * to prevent false suffix matches (e.g. "other-refs.bib" matching "refs.bib").
 */
export function bibFileEndsWith(
  entryBibFile: string | undefined,
  eventBibFile: string,
): boolean {
  if (!entryBibFile) return false;
  if (entryBibFile === eventBibFile) return true;
  return entryBibFile.endsWith("/" + eventBibFile);
}

/**
 * Find the citekey whose page_id matches the given relativePath.
 * When multiple citekeys share the same page_id, returns the
 * lexicographically smallest one to ensure deterministic selection.
 */
export function findBibKeyForPage(
  states: Record<string, BibKeyState>,
  relativePath: string,
  entries?: BibEntry[],
): string | undefined {
  const matches = Object.keys(states).filter(
    (k) => states[k]?.page_id === relativePath,
  );
  if (matches.length > 0) {
    matches.sort();
    return matches[0];
  }
  const stem = relativePath.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (stem && states[stem] != null) return stem;
  if (stem && entries) {
    const match = entries.find((e) => e.key === stem);
    if (match) return match.key;
  }
  return undefined;
}

function combinedText(entry: BibEntry): string {
  return [
    entry.key,
    entry.title,
    entry.authors.join(" "),
    (entry.editors ?? []).join(" "),
    (entry.tags ?? []).join(" "),
    entry.journal ?? "",
    entry.publisher ?? "",
    entry.isbn ?? "",
  ].join(" ");
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

// Lightweight UI heuristic only; full validation with check-digits lives in recognize/identifiers.rs
const ISBN_RE = /^(?:\d{9}[\dXx]|97[89]\d{10})$/;

function looksLikeIsbn(query: string): boolean {
  return ISBN_RE.test(query.replace(/[-\s]/g, ""));
}

export function ReferenceLibrary() {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const selectPageAtLine = useWorkspaceStore((s) => s.selectPageAtLine);
  const refreshPages = useWorkspaceStore((s) => s.refreshPages);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const show = useStatusMessageStore((s) => s.show);
  const modHeld = useModKeyHeld();
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [bibKeyStates, setBibKeyStates] = useState<Record<string, BibKeyState>>({});
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [materializingKey, setMaterializingKey] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importPdfDialogOpen, setImportPdfDialogOpen] = useState(false);
  const [enrichingKey, setEnrichingKey] = useState<string | null>(null);
  const [enrichPhase, setEnrichPhase] = useState<"fetch" | "search">("fetch");
  const enrichPhaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ bytes: number; total: number | null } | null>(null);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [ocrEntry, setOcrEntry] = useState<BibEntry | null>(null);
  const [ocrCompanionCurrentMap, setOcrCompanionCurrentMap] = useState<Record<string, string | false>>({});
  const ocrCheckIdRef = useRef(0);
  const [enrichCandidates, setEnrichCandidates] = useState<EnrichCandidateState | null>(null);
  const [dropPdfPath, setDropPdfPath] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

  // Clean up enrichPhase timer on unmount
  useEffect(() => {
    return () => {
      if (enrichPhaseTimerRef.current) {
        clearTimeout(enrichPhaseTimerRef.current);
      }
    };
  }, []);

  // Derive stable primitives from the expanded entry to avoid re-firing the
  // companion-check effect on every entries array rebuild (F5).
  const expandedEntry = useMemo(() => {
    if (!expandedKey) return undefined;
    return entries.find(
      (e) => `${e.bib_file ?? ""}:${e.key}` === expandedKey,
    );
  }, [entries, expandedKey]);

  const expandedFile = expandedEntry?.file;
  const expandedBibKey = expandedEntry?.key;

  // Check if OCR companion markdown is current when an entry is expanded
  useEffect(() => {
    if (!expandedKey || !workspacePath || !expandedFile || !expandedBibKey) {
      return () => { ocrCheckIdRef.current++; };
    }
    const id = ++ocrCheckIdRef.current;
    isOcrCompanionCurrent(expandedBibKey, workspacePath, expandedFile).then(
      (result) => {
        if (id !== ocrCheckIdRef.current) return;
        setOcrCompanionCurrentMap((prev) => ({ ...prev, [expandedKey]: result ?? false }));
      },
      () => {
        // On error, treat as not current (don't hide button)
        if (id !== ocrCheckIdRef.current) return;
        setOcrCompanionCurrentMap((prev) => ({ ...prev, [expandedKey]: false }));
      },
    );
    return () => { ocrCheckIdRef.current++; };
  }, [expandedKey, expandedFile, expandedBibKey, workspacePath]);

  // --- Search tab state ---
  const [mode, setMode] = useState<"library" | "search">("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMode, setSearchMode] = useState("auto");
  const [searchResults, setSearchResults] = useState<PaperSearchResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const [duplicateKeys, setDuplicateKeys] = useState<Map<string, string>>(new Map());

  const handleSearchPapers = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const st = searchMode !== "auto" ? searchMode : looksLikeIsbn(q) ? "isbn" : undefined;
      const result = await searchPapers(q, undefined, undefined, st);
      setSearchResults(result);
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSearching(false);
    }
  }, [searchQuery, searching, show, searchMode]);

  const handleSaveSearchResult = useCallback(async (entry: BibEntry) => {
    if (!workspacePath) return;
    const stableKey = entry.doi ?? entry.key;
    setSavingKeys((prev) => new Set(prev).add(stableKey));
    try {
      const outcomes = await saveBibEntry(entry, workspacePath);
      for (const o of outcomes) {
        if (isSaved(o)) {
          setSavedKeys((prev) => new Set(prev).add(stableKey));
          show(`Saved @${o.Saved.key}`);
        } else if (isSavedNoDoi(o)) {
          setSavedKeys((prev) => new Set(prev).add(stableKey));
          show(`Saved @${o.SavedNoDoi.key}`);
        } else if (isDuplicateDoi(o)) {
          setDuplicateKeys((prev) => new Map(prev).set(o.DuplicateDoi.doi, o.DuplicateDoi.existing_key));
          show(`Already in library as @${o.DuplicateDoi.existing_key}`);
        }
      }
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(stableKey);
        return next;
      });
    }
  }, [workspacePath, show]);

  const dropPdf = useDropPdf({
    enabled: !!workspacePath,
    showToast: show,
  });

  const currentPageRef = useRef(currentPagePath ?? "");
  currentPageRef.current = currentPagePath ?? "";
  const recordDeparture = useRecordDeparture(currentPageRef);

  const requestIdRef = useRef(0);
  const bibStatesRequestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadEntries = useCallback(() => {
    if (!workspacePath) {
      setEntries([]);
      return;
    }
    const id = ++requestIdRef.current;
    listBibEntries(workspacePath)
      .then((result) => {
        if (id === requestIdRef.current) setEntries(result);
      })
      .catch(() => {
        if (id === requestIdRef.current) setEntries([]);
      });
  }, [workspacePath]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  const loadBibKeyStates = useCallback(() => {
    if (!graphReady) {
      setBibKeyStates({});
      return;
    }
    const id = ++bibStatesRequestIdRef.current;
    getBibKeyStates()
      .then((result) => {
        if (id === bibStatesRequestIdRef.current) setBibKeyStates(result);
      })
      .catch(() => {
        if (id === bibStatesRequestIdRef.current) setBibKeyStates({});
      });
  }, [graphReady]);

  useEffect(() => {
    loadBibKeyStates();
  }, [loadBibKeyStates]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:graph-updated", () => {
      loadEntries();
      loadBibKeyStates();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [loadEntries, loadBibKeyStates]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen("lit:bib-items-changed", () => {
      loadEntries();
      loadBibKeyStates();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => { cancelled = true; unlisten?.(); };
  }, [loadEntries, loadBibKeyStates]);

  useEffect(() => {
    if (!workspacePath) return;

    let cancelled = false;
    const unlisteners: (() => void)[] = [];

    const onBibEvent = (event: { payload: FileEvent }) => {
      if (cancelled) return;
      if (event.payload.path.toLowerCase().endsWith(".bib")) {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          debounceRef.current = null;
          loadEntries();
          loadBibKeyStates();
        }, 200);
      }
    };

    const setup = async () => {
      for (const name of [
        "workspace://file-created",
        "workspace://file-modified",
        "workspace://file-deleted",
      ]) {
        const unlisten = await listen<FileEvent>(name, onBibEvent);
        if (cancelled) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = null;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [workspacePath, loadEntries, loadBibKeyStates]);

  useEffect(() => {
    if (!downloadingKey) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<{ key: string; bytes_downloaded: number; bytes_total: number | null }>(
      "lit:pdf-download-progress",
      (event) => {
        if (cancelled) return;
        if (event.payload.key === downloadingKey) {
          setDownloadProgress({
            bytes: event.payload.bytes_downloaded,
            total: event.payload.bytes_total,
          });
        }
      },
    ).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [downloadingKey]);

  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const aHash = initialOf(a) === "#" ? 1 : 0;
      const bHash = initialOf(b) === "#" ? 1 : 0;
      if (aHash !== bHash) return aHash - bHash;
      const byName = lastName(a).localeCompare(lastName(b), undefined, {
        sensitivity: "base",
      });
      if (byName !== 0) return byName;
      return (a.year ?? "").localeCompare(b.year ?? "");
    });
  }, [entries]);

  const filtered = useMemo(
    () => localeFilter(sorted, deferredSearch, combinedText),
    [sorted, deferredSearch],
  );

  const { items: sectionedItems, letterSet, letterToIndex } = useMemo(
    () => buildSectionedList(filtered),
    [filtered],
  );

  const toggleExpand = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

  const navigateToBibFile = useCallback(
    (entry: BibEntry) => {
      if (!entry.bib_file || !workspacePath) return;
      if (!entry.bib_file.startsWith(workspacePath + "/")) return;
      const relativePath = entry.bib_file.slice(workspacePath.length + 1);
      selectPageAtLine(relativePath, entry.line_number + 1);
    },
    [workspacePath, selectPageAtLine],
  );

  const copyCitation = useCallback(
    (key: string) => {
      navigator.clipboard
        .writeText(`[@${key}]`)
        .then(() => show(`Copied [@${key}]`))
        .catch(() => show("Failed to copy citation", "error"));
    },
    [show],
  );

  const doMaterialize = useMaterializeCitation({
    recordDeparture,
    navigate: selectPage,
    onError: (msg) => show(msg, "error"),
    onMaterialized: loadBibKeyStates,
  });

  const materializeNote = useCallback(
    async (bibKey: string) => {
      if (materializingKey !== null) return;
      setMaterializingKey(bibKey);
      try {
        await doMaterialize(bibKey);
      } finally {
        setMaterializingKey(null);
      }
    },
    [materializingKey, doMaterialize],
  );

  /** Shared enrichment flow: spinner, phase timer, classify result, toast. */
  const runEnrichFlow = useCallback(
    async (
      bibKey: string,
      title: string,
      ipcFn: () => Promise<import("../lib/ipc").EnrichResult>,
    ) => {
      setEnrichingKey(bibKey);
      setEnrichPhase("fetch");
      if (enrichPhaseTimerRef.current) clearTimeout(enrichPhaseTimerRef.current);
      enrichPhaseTimerRef.current = setTimeout(() => {
        setEnrichPhase("search");
      }, 1500);
      try {
        const result = await ipcFn();
        const classified = classifyEnrichResult(result, bibKey, title);
        dispatchEnrichResult(classified, setEnrichCandidates, show);
      } catch (err) {
        show(
          err instanceof Error ? err.message : String(err),
          "error",
        );
      } finally {
        setEnrichingKey(null);
        if (enrichPhaseTimerRef.current) {
          clearTimeout(enrichPhaseTimerRef.current);
          enrichPhaseTimerRef.current = null;
        }
      }
    },
    [show, setEnrichCandidates],
  );

  const handleEnrich = useCallback(
    async (entry: BibEntry) => {
      if (!workspacePath) return;
      setEnrichCandidates(null); // close any open picker (T3.3.2)
      await runEnrichFlow(entry.key, entry.title, () =>
        enrichBibEntry(entry.key, workspacePath),
      );
    },
    [workspacePath, runEnrichFlow, setEnrichCandidates],
  );

  const handleApplyCandidate = useCallback(
    async (candidate: BibEntry) => {
      if (!workspacePath || !enrichCandidates) return;
      const { bibKey, title } = enrichCandidates;
      setEnrichCandidates(null); // close picker immediately
      await runEnrichFlow(bibKey, title, () =>
        applyEnrichmentCandidate(bibKey, candidate, workspacePath),
      );
    },
    [workspacePath, enrichCandidates, runEnrichFlow, setEnrichCandidates],
  );

  const handleDownload = useCallback(
    async (entry: BibEntry) => {
      if (!workspacePath || downloadingKey || linkingKey) return;
      setDownloadingKey(entry.key);
      setDownloadProgress(null);
      try {
        await downloadEntryPdf(entry.key, workspacePath);
        show(`Downloaded PDF for @${entry.key}`);
        setOcrCompanionCurrentMap((prev) => {
          const next = { ...prev };
          delete next[`${entry.bib_file ?? ""}:${entry.key}`];
          return next;
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show(msg, "error");
      } finally {
        setDownloadingKey(null);
        setDownloadProgress(null);
      }
    },
    [workspacePath, downloadingKey, linkingKey, show],
  );

  const handleLinkPdf = useCallback(
    async (entry: BibEntry) => {
      if (!workspacePath || linkingKey || downloadingKey) return;
      setLinkingKey(entry.key);
      try {
        const { ask, open: openDialog } = await import("@tauri-apps/plugin-dialog");

        // Re-link confirmation: ask before overwriting an existing linked PDF
        if (entry.file) {
          const confirmed = await ask(
            `This entry already has a linked PDF:\n${entry.file}\n\nReplace it?`,
            { title: "Replace linked PDF?", kind: "warning" },
          );
          if (!confirmed) return;
        }

        const selected = await openDialog({
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (!selected || typeof selected !== "string") return;
        await linkEntryPdf(entry.key, selected, workspacePath);
        show(`Linked PDF for @${entry.key}`);
        setOcrCompanionCurrentMap((prev) => {
          const next = { ...prev };
          delete next[`${entry.bib_file ?? ""}:${entry.key}`];
          return next;
        });
      } catch (err) {
        show(
          err instanceof Error ? err.message : String(err),
          "error",
        );
      } finally {
        setLinkingKey(null);
      }
    },
    [workspacePath, linkingKey, downloadingKey, show],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const expandedIndex = useMemo(
    () =>
      sectionedItems.findIndex(
        (item) =>
          item.kind === "entry" &&
          `${item.entry.bib_file ?? ""}:${item.entry.key}` === expandedKey,
      ),
    [sectionedItems, expandedKey],
  );
  const virtualizer = useVirtualizer({
    count: sectionedItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const item = sectionedItems[index];
      if (!item || item.kind === "header") return 24;
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

  useLayoutEffect(() => {
    if (expandedIndex < 0) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-index="${expandedIndex}"]`,
    );
    if (el) virtualizer.measureElement(el);
  }, [sectionedItems, expandedIndex, virtualizer]);

  const scrollAfterEnrichRef = useRef<string | null>(null);
  const prevEnrichingKeyRef = useRef(enrichingKey);
  useEffect(() => {
    const prevKey = prevEnrichingKeyRef.current;
    prevEnrichingKeyRef.current = enrichingKey;
    if (prevKey && !enrichingKey) {
      scrollAfterEnrichRef.current = prevKey;
    }
  }, [enrichingKey]);

  useEffect(() => {
    const pendingKey = scrollAfterEnrichRef.current;
    if (!pendingKey || expandedIndex < 0) return;
    const item = sectionedItems[expandedIndex];
    if (item?.kind !== "entry" || item.entry.key !== pendingKey) return;
    scrollAfterEnrichRef.current = null;
    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(expandedIndex, { align: "auto" });
    });
  }, [sectionedItems, expandedIndex, virtualizer]);

  const scrollToLetter = useCallback(
    (letter: string, smooth: boolean) => {
      const index = letterToIndex.get(letter);
      if (index != null) virtualizer.scrollToIndex(index, { align: "start", ...(smooth && { behavior: "smooth" }) });
    },
    [letterToIndex, virtualizer],
  );

  const handleLetterClick = useCallback(
    (letter: string) => scrollToLetter(letter, true),
    [scrollToLetter],
  );

  const handleLetterDrag = useCallback(
    (letter: string) => scrollToLetter(letter, false),
    [scrollToLetter],
  );

  // Why the local copy? The hook's droppedPdfPath is cleared immediately after
  // being consumed so that dropping the *same* file path a second time still
  // triggers a null->path transition (and thus re-fires this effect). Passing
  // droppedPdfPath directly to ImportPdfDialog without clearing it would make a
  // second drop of the same path a no-op, because React skips effects when the
  // dependency value hasn't changed.
  useEffect(() => {
    if (dropPdf.droppedPdfPath) {
      setDropPdfPath(dropPdf.droppedPdfPath);
      dropPdf.clearDroppedPdfPath();
      setImportPdfDialogOpen(true);
    }
  }, [dropPdf.droppedPdfPath, dropPdf.clearDroppedPdfPath]);

  const sectionedItemsRef = useRef(sectionedItems);
  sectionedItemsRef.current = sectionedItems;
  const virtualizerRef = useRef(virtualizer);
  virtualizerRef.current = virtualizer;
  const { revealedKey, triggerReveal } = useRevealFlash(virtualizerRef);
  const sortedRef = useRef(sorted);
  sortedRef.current = sorted;
  const bibKeyStatesRef = useRef(bibKeyStates);
  bibKeyStatesRef.current = bibKeyStates;
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const pendingRevealForPageRef = useRef<string | null>(null);

  const revealEntry = useCallback((citekey: string, bibFile?: string) => {
    ensureSidebarVisible();
    dispatchSetSidebarTab("references");

    setSearch("");

    const items = buildSectionedList(sortedRef.current).items;
    let idx = -1;
    if (bibFile) {
      idx = items.findIndex(
        (item) =>
          item.kind === "entry" &&
          item.entry.key === citekey &&
          bibFileEndsWith(item.entry.bib_file, bibFile),
      );
    }
    if (idx < 0) {
      idx = items.findIndex(
        (item) => item.kind === "entry" && item.entry.key === citekey,
      );
    }
    if (idx < 0) return;

    const item = items[idx]!;
    if (item.kind !== "entry") return;
    const entryId = `${item.entry.bib_file ?? ""}:${item.entry.key}`;

    setExpandedKey(entryId);
    triggerReveal(entryId, idx);
  }, [triggerReveal]);

  useEffect(() => {
    return onRevealBibEntry(({ citekey, bibFile }) => {
      revealEntry(citekey, bibFile);
    });
  }, [revealEntry]);

  useEffect(() => {
    return onRevealBibEntryForPage(({ relativePath }) => {
      const states = bibKeyStatesRef.current;
      const citekey = findBibKeyForPage(states, relativePath, entriesRef.current);
      if (!citekey) {
        if (Object.keys(states).length === 0) {
          pendingRevealForPageRef.current = relativePath;
        } else {
          show("No matching reference found for this page");
        }
        return;
      }
      pendingRevealForPageRef.current = null;
      revealEntry(citekey);
    });
  }, [revealEntry, show]);

  // Retry deferred reveal-for-page when bibKeyStates become available
  useEffect(() => {
    const pendingPath = pendingRevealForPageRef.current;
    if (!pendingPath || Object.keys(bibKeyStates).length === 0) return;
    const citekey = findBibKeyForPage(bibKeyStates, pendingPath, entries);
    pendingRevealForPageRef.current = null;
    if (citekey) {
      revealEntry(citekey);
    } else {
      show("No matching reference found for this page");
    }
  }, [bibKeyStates, revealEntry, show]);

  const addButton = (
    <button
      data-testid="reference-library-add-btn"
      onClick={() => setAddDialogOpen(true)}
      disabled={!workspacePath}
      className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
    >
      + Add
    </button>
  );

  const importPdfButton = (
    <button
      data-testid="reference-library-import-pdf-btn"
      onClick={() => setImportPdfDialogOpen(true)}
      disabled={!workspacePath}
      className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
    >
      Import PDF...
    </button>
  );

  const dialog = (
    <AddReferenceDialog
      open={addDialogOpen}
      onClose={() => setAddDialogOpen(false)}
      onSaved={() => {
        setAddDialogOpen(false);
      }}
    />
  );

  const importPdfDialog = (
    <ImportPdfDialog
      open={importPdfDialogOpen}
      onClose={() => {
        setImportPdfDialogOpen(false);
        setDropPdfPath(null);
      }}
      onImported={() => {
        setImportPdfDialogOpen(false);
        setDropPdfPath(null);
      }}
      initialPdfPath={dropPdfPath}
    />
  );

  const showStrip = filtered.length >= 30;
  const virtualItems = virtualizer.getVirtualItems();
  const activeLetter = useMemo(() => {
    if (virtualItems.length === 0) return "";
    const topIndex = virtualItems[0]!.index;
    for (let i = topIndex; i >= 0; i--) {
      const item = sectionedItems[i];
      if (item?.kind === "header") return item.letter;
    }
    return "";
  }, [virtualItems[0]?.index, sectionedItems]);

  const modeOptions = useMemo(() => [
    { value: "library", label: "Library" },
    { value: "search", label: "Search" },
  ], []);

  return (
    <div
      ref={dropPdf.panelRef}
      data-testid="reference-library-panel"
      className={`flex flex-1 flex-col overflow-hidden${dropPdf.isDropHighlighted ? " drop-highlight" : ""}`}
    >
      <div className="flex items-center justify-center px-2 pt-2 pb-1">
        <SegmentedControl
          options={modeOptions}
          value={mode}
          onChange={(v) => setMode(v as "library" | "search")}
          testId="ref-lib-mode"
        />
      </div>

      {mode === "search" && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-2 pb-1">
            <input
              type="text"
              placeholder="Search academic papers..."
              aria-label="Search academic papers"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearchPapers();
              }}
              className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-normal"
            />
            <select
              data-testid="search-mode-select"
              value={searchMode}
              onChange={(e) => setSearchMode(e.target.value)}
              className="rounded border border-border bg-bg-primary px-1 py-1 text-xs text-text-normal"
            >
              <option value="auto">Auto</option>
              <option value="keywords">Keywords</option>
              <option value="isbn">ISBN</option>
              <option value="doi">DOI</option>
              <option value="author">Author</option>
              <option value="title">Title</option>
            </select>
            <button
              data-testid="search-papers-btn"
              onClick={handleSearchPapers}
              disabled={searching || !searchQuery.trim()}
              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>
          {searchMode === "auto" && looksLikeIsbn(searchQuery) && (
            <div data-testid="isbn-auto-detect-hint" className="px-2 pb-1 text-xs text-interactive-accent">
              Searching by ISBN
            </div>
          )}
          {searchResults ? (
            <PaperSearchResults
              results={searchResults}
              onSave={handleSaveSearchResult}
              savingKeys={savingKeys}
              savedKeys={savedKeys}
              duplicateKeys={duplicateKeys}
            />
          ) : searching ? (
            <div className="flex flex-1 items-center justify-center text-xs text-text-faint">
              Searching...
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-text-faint">
              Enter a query to search academic papers
            </div>
          )}
        </div>
      )}

      {mode === "library" && entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center text-xs text-text-faint">
          <div>No references found. Add .bib files to your workspace.</div>
          <div className="mt-2 flex gap-2">{addButton}{importPdfButton}</div>
        </div>
      ) : mode === "library" ? (
        <>
          <div className="flex items-center gap-2 p-2">
            <input
              type="text"
              placeholder="Search references…"
              aria-label="Search references"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-xs text-text-normal"
            />
            {addButton}
            {importPdfButton}
          </div>
          <div className="relative flex flex-1 overflow-hidden">
          <div
            ref={scrollRef}
            data-testid="reference-library-list"
            data-virtual-scroll
            className={`flex-1 overflow-y-auto overscroll-contain px-1${showStrip ? " pr-5" : ""}`}
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualItems.map((virtualRow) => {
                const item = sectionedItems[virtualRow.index];
                if (!item) return null;

                if (item.kind === "header") {
                  return (
                    <div
                      key={`header-${item.letter}`}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                    >
                      <div
                        data-testid="section-header"
                        role="heading"
                        aria-level={2}
                        className="px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-text-section-header"
                      >
                        {item.letter}
                      </div>
                    </div>
                  );
                }

                const entry = item.entry;
                const entryId = `${entry.bib_file ?? ""}:${entry.key}`;
                const isExpanded = expandedKey === entryId;
                const isRevealed = revealedKey === entryId;
                const tags = entry.tags ?? [];
                const state = bibKeyStates[entry.key];
                return (
                  <div
                    key={entryId}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    className={[
                      state?.page_id
                        ? "border-l-2 border-interactive-accent"
                        : state?.materialization === "partial"
                          ? "border-l-2 border-dashed border-text-muted"
                          : undefined,
                      isRevealed ? "bib-entry-revealed" : undefined,
                    ].filter(Boolean).join(" ") || undefined}
                    data-indicator={
                      state?.page_id ? "has-note"
                        : state?.materialization === "partial" ? "enriched"
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
                    <button
                      onClick={() => toggleExpand(entryId)}
                      className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded px-2 py-1 text-start hover:bg-bg-hover"
                    >
                      <span
                        data-testid="reference-entry-title"
                        className={`w-full truncate text-xs ${modHeld && entry.bib_file ? "cursor-pointer underline text-interactive-accent" : "text-text-normal"}`}
                        onClick={(e) => {
                          if ((e.metaKey || e.ctrlKey) && entry.bib_file) {
                            e.stopPropagation();
                            navigateToBibFile(entry);
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
                                navigateToBibFile(entry);
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
                          <BibEntryActions
                            entry={entry}
                            state={state}
                            onOpenNote={(pageId) => {
                              recordDeparture();
                              selectPage(pageId);
                            }}
                            onCreateNote={materializeNote}
                            onEnrich={handleEnrich}
                            onOpenPdf={selectPage}
                            onOpenMarkdown={(filename) => { recordDeparture(); selectPage(filename); }}
                            onOcr={(e) => { if (workspacePath) setOcrEntry(e); }}
                            onCopyCitation={copyCitation}
                            onDownloadPdf={handleDownload}
                            onLinkPdf={handleLinkPdf}
                            materializingKey={materializingKey}
                            enrichingKey={enrichingKey}
                            enrichPhase={enrichPhase}
                            downloadingKey={downloadingKey}
                            downloadProgress={downloadProgress}
                            linkingKey={linkingKey}
                            ocrCompanionCurrent={ocrCompanionCurrentMap[entryId]}
                          />
                          <CitedBySection bibKey={entry.key} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
          <AlphabetStrip
            letterSet={letterSet}
            activeLetter={activeLetter}
            onLetterClick={handleLetterClick}
            onLetterDrag={handleLetterDrag}
            visible={showStrip}
          />
          </div>
        </>
      ) : null}
      {dialog}
      {importPdfDialog}
      {ocrEntry && workspacePath ? (
        <OcrDialog
          entry={ocrEntry}
          workspacePath={workspacePath}
          onClose={() => setOcrEntry(null)}
          onComplete={(path) => {
            const key = ocrEntry.key;
            const compositeKey = `${ocrEntry.bib_file ?? ""}:${key}`;
            setOcrEntry(null);
            show("OCR complete for @" + key);
            setOcrCompanionCurrentMap((prev) => ({ ...prev, [compositeKey]: path }));
            refreshPages();
            selectPage(path);
          }}
        />
      ) : null}
      <EnrichCandidatePicker
        open={enrichCandidates !== null}
        bibKey={enrichCandidates?.bibKey ?? ""}
        candidates={enrichCandidates?.candidates ?? []}
        providersSearched={enrichCandidates?.providersSearched ?? []}
        providersFailed={enrichCandidates?.providersFailed ?? []}
        onApply={handleApplyCandidate}
        onClose={() => setEnrichCandidates(null)}
      />
    </div>
  );
}
