import {
  useEffect,
  useState,
  useMemo,
  useRef,
  useDeferredValue,
  useCallback,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import {
  listBibEntries,
  getCitingPages,
  getBibKeyStates,
  enrichBibEntry,
  bibDelete,
  bibUpdateFields,
  downloadEntryPdf,
  linkEntryPdf,
  importZoteroAnnotations,
  type BibEntry,
  type BibKeyState,
  type BacklinkEntry,
  type FileEvent,
} from "../lib/ipc";
import { useMaterializeCitation } from "../hooks/useMaterializeCitation";
import { useDropPdf } from "../hooks/useDropPdf";
import { localeFilter } from "../lib/localeSearch";
import { AddReferenceDialog } from "./AddReferenceDialog";
import { ImportPdfDialog } from "./ImportPdfDialog";
import { OcrDialog } from "./OcrDialog";
import { highlightWikilinks } from "../lib/highlightWikilinks";
import { useRecordDeparture } from "../hooks/useRecordDeparture";
import { doiHref } from "../lib/urlUtils";

function lastName(entry: BibEntry): string {
  const first = entry.authors[0] ?? "";
  const comma = first.indexOf(",");
  const name = comma >= 0 ? first.slice(0, comma).trim() : first.trim();
  return name || first;
}

function combinedText(entry: BibEntry): string {
  return [
    entry.key,
    entry.title,
    entry.authors.join(" "),
    (entry.tags ?? []).join(" "),
    entry.journal ?? "",
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

export function ReferenceLibrary() {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const graphReady = useWorkspaceStore((s) => s.graphReady);
  const selectPage = useWorkspaceStore((s) => s.selectPage);
  const refreshPages = useWorkspaceStore((s) => s.refreshPages);
  const currentPagePath = useWorkspaceStore((s) => s.currentPagePath);
  const show = useStatusMessageStore((s) => s.show);
  const [entries, setEntries] = useState<BibEntry[]>([]);
  const [bibKeyStates, setBibKeyStates] = useState<Record<string, BibKeyState>>({});
  const [search, setSearch] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [materializingKey, setMaterializingKey] = useState<string | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [importPdfDialogOpen, setImportPdfDialogOpen] = useState(false);
  const [enrichingKey, setEnrichingKey] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{ bytes: number; total: number | null } | null>(null);
  const [linkingKey, setLinkingKey] = useState<string | null>(null);
  const [ocrEntry, setOcrEntry] = useState<BibEntry | null>(null);
  const [importingZoteroKey, setImportingZoteroKey] = useState<string | null>(null);
  const [dropPdfPath, setDropPdfPath] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search);

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

  const toggleExpand = useCallback((key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key));
  }, []);

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

  const handleEnrich = useCallback(
    async (entry: BibEntry) => {
      if (!workspacePath) return;
      setEnrichingKey(entry.key);
      try {
        const result = await enrichBibEntry(entry.key, workspacePath);
        const parts: string[] = [];
        if (result.fields_added.length > 0)
          parts.push(`added ${result.fields_added.join(", ")}`);
        if (result.references_appended > 0) {
          const qualifier =
            result.references_found > result.references_appended
              ? ` of ${result.references_found}`
              : "";
          parts.push(
            `${result.references_appended}${qualifier} references added`,
          );
        }
        if (result.shadow_nodes_created > 0)
          parts.push(`${result.shadow_nodes_created} shadow nodes created`);
        show(
          `Enriched ${entry.key}${parts.length > 0 ? ": " + parts.join(". ") : ""}`,
        );
      } catch (err) {
        show(
          err instanceof Error ? err.message : String(err),
          "error",
        );
      } finally {
        setEnrichingKey(null);
      }
    },
    [workspacePath, show],
  );

  const handleDownload = useCallback(
    async (entry: BibEntry) => {
      if (!workspacePath || downloadingKey || linkingKey) return;
      setDownloadingKey(entry.key);
      setDownloadProgress(null);
      try {
        await downloadEntryPdf(entry.key, workspacePath);
        show(`Downloaded PDF for @${entry.key}`);
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

  const handleImportZotero = useCallback(
    async (entry: BibEntry) => {
      if (!workspacePath || importingZoteroKey) return;
      setImportingZoteroKey(entry.key);
      try {
        const result = await importZoteroAnnotations(entry.key, workspacePath);
        if (result.inserted === 0 && result.skipped === 0) {
          show(`No annotations found in Zotero for @${entry.key}`);
        } else if (result.inserted === 0 && result.skipped > 0) {
          show(`All annotations already imported for @${entry.key}`);
        } else {
          show(`Imported ${result.inserted} annotations for @${entry.key} (${result.unmatched} unmatched, ${result.skipped} skipped)`);
        }
        refreshPages();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        show(msg, "error");
      } finally {
        setImportingZoteroKey(null);
      }
    },
    [workspacePath, importingZoteroKey, show, refreshPages],
  );

  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  const handleDelete = useCallback(async (key: string) => {
    if (!workspacePath) return;
    if (!window.confirm(`Delete @${key} from the library? The .bib file on disk will not be modified.`)) return;
    setDeletingKey(key);
    try {
      const deleted = await bibDelete(key, workspacePath);
      if (deleted) {
        show(`Deleted @${key}`);
      } else {
        show(`@${key} not found`, "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setDeletingKey(null);
    }
  }, [workspacePath, show]);

  const startEdit = useCallback((entry: BibEntry) => {
    setEditingKey(entry.key);
    setEditFields({
      title: entry.title,
      authors: entry.authors.join("; "),
      year: entry.year,
      journal: entry.journal ?? "",
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingKey(null);
    setEditFields({});
  }, []);

  const saveEdit = useCallback(async (key: string) => {
    if (!workspacePath) return;
    setSavingEdit(true);
    try {
      const entry = filtered.find((e) => e.key === key);
      if (!entry) return;

      const fields: Record<string, string> = {};
      const original: Record<string, string> = {
        title: entry.title,
        authors: entry.authors.join("; "),
        year: entry.year,
        journal: entry.journal ?? "",
      };
      for (const [k, v] of Object.entries(editFields)) {
        if (v !== original[k]) {
          fields[k] = v;
        }
      }
      if (Object.keys(fields).length === 0) {
        setSavingEdit(false);
        setEditingKey(null);
        setEditFields({});
        return;
      }

      const updated = await bibUpdateFields(key, fields, workspacePath);
      if (updated) {
        show(`Updated @${key}`);
      } else {
        show(`@${key} not found`, "error");
      }
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setSavingEdit(false);
      setEditingKey(null);
      setEditFields({});
    }
  }, [workspacePath, editFields, filtered, show]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const expandedIndex = useMemo(
    () =>
      filtered.findIndex(
        (e) => `${e.bib_file ?? ""}:${e.key}` === expandedKey,
      ),
    [filtered, expandedKey],
  );
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (index === expandedIndex ? 260 : 36),
    overscan: 10,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, expandedIndex]);

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

  return (
    <div
      ref={dropPdf.panelRef}
      data-testid="reference-library-panel"
      className={`flex flex-1 flex-col overflow-hidden${dropPdf.isDropHighlighted ? " drop-highlight" : ""}`}
    >
      {entries.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center text-sm text-text-faint">
          <div>No references found. Add .bib files to your workspace.</div>
          <div className="mt-2 flex gap-2">{addButton}{importPdfButton}</div>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 p-2">
            <input
              type="text"
              placeholder="Search references…"
              aria-label="Search references"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-sm text-text-normal"
            />
            {addButton}
            {importPdfButton}
          </div>
          <div
            ref={scrollRef}
            data-testid="reference-library-list"
            data-virtual-scroll
            className="flex-1 overflow-y-auto overscroll-contain px-1"
          >
            <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const entry = filtered[virtualRow.index]!;
                const entryId = `${entry.bib_file ?? ""}:${entry.key}`;
                const isExpanded = expandedKey === entryId;
                const tags = entry.tags ?? [];
                const state = bibKeyStates[entry.key];
                return (
                  <div
                    key={entryId}
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
                    <button
                      onClick={() => toggleExpand(entryId)}
                      className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded px-2 py-1 text-start hover:bg-bg-hover"
                    >
                      <span
                        data-testid="reference-entry-title"
                        className="w-full truncate text-sm text-text-normal"
                      >
                        {entry.title}
                      </span>
                      <span className="w-full truncate text-xs text-text-muted">
                        {entry.authors.join("; ")}
                        {entry.year ? ` (${entry.year})` : ""}
                      </span>
                      {state?.page_id ? (
                        <span
                          data-testid="badge-has-note"
                          className="mt-0.5 inline-block rounded bg-interactive-accent/15 px-1.5 py-0.5 text-xs text-interactive-accent"
                        >
                          Has note
                        </span>
                      ) : state?.materialization === "partial" ? (
                        <span
                          data-testid="badge-enriched"
                          className="mt-0.5 inline-block rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted"
                        >
                          Enriched
                        </span>
                      ) : null}
                    </button>
                    {isExpanded ? (
                      <div className="mt-1 rounded border border-border bg-bg-primary px-2 py-2 text-sm">
                        {editingKey === entry.key ? (
                          <div className="space-y-2">
                            <div>
                              <label className="block text-xs text-text-muted">Title</label>
                              <input data-testid="edit-field-title" type="text" value={editFields.title ?? ""}
                                onChange={(e) => setEditFields(f => ({...f, title: e.target.value}))}
                                className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-sm text-text-normal" />
                            </div>
                            <div>
                              <label className="block text-xs text-text-muted">Authors (semicolon-separated)</label>
                              <input data-testid="edit-field-authors" type="text" value={editFields.authors ?? ""}
                                onChange={(e) => setEditFields(f => ({...f, authors: e.target.value}))}
                                className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-sm text-text-normal" />
                            </div>
                            <div>
                              <label className="block text-xs text-text-muted">Year</label>
                              <input data-testid="edit-field-year" type="text" value={editFields.year ?? ""}
                                onChange={(e) => setEditFields(f => ({...f, year: e.target.value}))}
                                className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-sm text-text-normal" />
                            </div>
                            <div>
                              <label className="block text-xs text-text-muted">Journal</label>
                              <input data-testid="edit-field-journal" type="text" value={editFields.journal ?? ""}
                                onChange={(e) => setEditFields(f => ({...f, journal: e.target.value}))}
                                className="w-full rounded border border-border bg-bg-secondary px-2 py-1 text-sm text-text-normal" />
                            </div>
                            <div className="flex gap-2">
                              <button data-testid="edit-save-btn" disabled={savingEdit}
                                onClick={() => saveEdit(entry.key)}
                                className="rounded bg-interactive-accent px-2 py-0.5 text-xs text-white hover:opacity-90 disabled:opacity-50">
                                {savingEdit ? "Saving..." : "Save"}
                              </button>
                              <button data-testid="edit-cancel-btn" onClick={cancelEdit}
                                className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover">
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="font-semibold text-text-normal">{entry.title}</div>
                            {entry.authors.length > 0 ? (
                              <div className="mt-1 text-text-muted">
                                {entry.authors.join("; ")}
                              </div>
                            ) : null}
                            {entry.year ? (
                              <div className="text-text-muted">{entry.year}</div>
                            ) : null}
                            {entry.journal ? (
                              <div className="text-text-muted">{entry.journal}</div>
                            ) : null}
                          </>
                        )}
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
                        {state?.page_id ? (
                          <div className="mt-2">
                            <button
                              data-testid="has-note-link"
                              onClick={() => {
                                recordDeparture();
                                selectPage(state.page_id!);
                              }}
                              className="rounded bg-interactive-accent/15 px-1.5 py-0.5 text-xs text-interactive-accent hover:underline"
                            >
                              Open note: {state.page_id}
                            </button>
                          </div>
                        ) : state ? (
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              data-testid="create-note-btn"
                              onClick={() => materializeNote(entry.key)}
                              disabled={materializingKey !== null}
                              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
                            >
                              {materializingKey === entry.key ? "Creating…" : "Create note"}
                            </button>
                            {state.materialization === "partial" ? (
                              <span
                                data-testid="badge-enriched"
                                className="rounded bg-bg-hover px-1.5 py-0.5 text-xs text-text-muted"
                              >
                                Enriched
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {!state?.page_id ? (
                          <div className="mt-2">
                            <button
                              data-testid="fetch-details-btn"
                              disabled={enrichingKey === entry.key}
                              onClick={() => handleEnrich(entry)}
                              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
                            >
                              {enrichingKey === entry.key
                                ? "Fetching…"
                                : state?.materialization === "partial"
                                  ? "Refresh"
                                  : "Fetch details"}
                            </button>
                          </div>
                        ) : null}
                        {entry.file ? (
                          <div className="mt-2 flex gap-2">
                            <button
                              data-testid="open-pdf-btn"
                              onClick={() => selectPage(entry.file!)}
                              title={entry.file}
                              className="rounded bg-interactive-accent/15 px-1.5 py-0.5 text-xs text-interactive-accent hover:underline"
                            >
                              Open PDF
                            </button>
                            <button
                              data-testid="ocr-btn"
                              onClick={() => { if (workspacePath) setOcrEntry(entry); }}
                              className="rounded bg-interactive-accent/15 px-1.5 py-0.5 text-xs text-interactive-accent hover:underline"
                            >
                              OCR to Markdown
                            </button>
                            <button
                              data-testid="import-zotero-btn"
                              disabled={importingZoteroKey === entry.key}
                              onClick={() => handleImportZotero(entry)}
                              className="rounded bg-interactive-accent/15 px-1.5 py-0.5 text-xs text-interactive-accent hover:underline disabled:opacity-50"
                            >
                              {importingZoteroKey === entry.key ? "Importing…" : "Zotero Annotations"}
                            </button>
                          </div>
                        ) : null}
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={() => copyCitation(entry.key)}
                            className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover"
                          >
                            Copy citation
                          </button>
                          {!entry.file && (entry.doi || entry.arxiv_id) ? (
                            <button
                              data-testid="download-pdf-btn"
                              disabled={downloadingKey === entry.key || linkingKey === entry.key}
                              onClick={() => handleDownload(entry)}
                              className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
                            >
                              {downloadingKey === entry.key
                                ? downloadProgress
                                  ? downloadProgress.total
                                    ? `Downloading ${Math.round((downloadProgress.bytes / downloadProgress.total) * 100)}%`
                                    : "Downloading…"
                                  : "Resolving…"
                                : "Download PDF"}
                            </button>
                          ) : null}
                          <button
                            data-testid="link-pdf-btn"
                            disabled={linkingKey === entry.key || downloadingKey === entry.key}
                            onClick={() => handleLinkPdf(entry)}
                            className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover disabled:opacity-50"
                          >
                            {linkingKey === entry.key
                              ? "Linking…"
                              : entry.file
                                ? "Re-link PDF"
                                : "Link PDF"}
                          </button>
                          <button data-testid="edit-entry-btn" onClick={() => startEdit(entry)}
                            className="rounded border border-border px-2 py-0.5 text-xs text-text-muted hover:bg-bg-hover">
                            Edit
                          </button>
                          <button
                            data-testid="delete-entry-btn"
                            disabled={deletingKey === entry.key}
                            onClick={() => handleDelete(entry.key)}
                            className="rounded border border-border px-2 py-0.5 text-xs text-text-error hover:bg-bg-hover disabled:opacity-50"
                          >
                            {deletingKey === entry.key ? "Deleting..." : "Delete"}
                          </button>
                        </div>
                        <CitedBySection bibKey={entry.key} />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
      {dialog}
      {importPdfDialog}
      {ocrEntry && workspacePath ? (
        <OcrDialog
          entry={ocrEntry}
          workspacePath={workspacePath}
          onClose={() => setOcrEntry(null)}
          onComplete={(path) => {
            const key = ocrEntry.key;
            setOcrEntry(null);
            show("OCR complete for @" + key);
            refreshPages();
            selectPage(path);
          }}
        />
      ) : null}
    </div>
  );
}
