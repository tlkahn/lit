import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import {
  lookupDoi,
  saveBibEntry,
  parseCslJson,
  saveBibEntries,
  isSaved,
  isDuplicateDoi,
  isSavedNoDoi,
  type BibEntry,
} from "../lib/ipc";
import { useBibFilePicker } from "../hooks/useBibFilePicker";
import { BibFilePicker } from "./BibFilePicker";

type Mode = "doi" | "import";

interface AddReferenceDialogProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function AddReferenceDialog({ open, onClose, onSaved }: AddReferenceDialogProps) {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const show = useStatusMessageStore((s) => s.show);

  const [mode, setMode] = useState<Mode>("doi");

  // DOI mode state
  const [doi, setDoi] = useState("");
  const [lookupResult, setLookupResult] = useState<BibEntry | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  // Import mode state
  const [importEntries, setImportEntries] = useState<BibEntry[]>([]);
  const [importFile, setImportFile] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Shared state
  const bib = useBibFilePicker(workspacePath, open);
  const [saving, setSaving] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setMode("doi");
      setDoi("");
      setLookupResult(null);
      setLookupError(null);
      setLooking(false);
      setImportEntries([]);
      setImportFile(null);
      setImportError(null);
      setSaving(false);
    }
  }, [open]);

  // Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  const effectiveBibPath = bib.effectiveBibPath;

  // DOI lookup
  async function handleLookup() {
    const trimmed = doi.trim();
    if (!trimmed) return;
    setLooking(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const entry = await lookupDoi(trimmed);
      setLookupResult(entry);
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : String(e));
    } finally {
      setLooking(false);
    }
  }

  // DOI save
  async function handleSave() {
    if (!lookupResult || !effectiveBibPath || !workspacePath) return;
    setSaving(true);
    try {
      const outcomes = await saveBibEntry(lookupResult, effectiveBibPath, workspacePath);
      const first = outcomes[0];
      if (first && isDuplicateDoi(first)) {
        show(
          `DOI already exists as @${first.DuplicateDoi.existing_key}`,
          "error",
        );
      } else if (first && isSaved(first)) {
        show(`Saved as @${first.Saved.key}`);
        onSaved();
      } else if (first && isSavedNoDoi(first)) {
        show(`Saved as @${first.SavedNoDoi.key} (no DOI)`);
        onSaved();
      }
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  // Import: choose file
  async function handleChooseFile() {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const path = await openDialog({
        filters: [{ name: "CSL-JSON", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") return;
      setImportFile(path);
      setImportError(null);

      const entries = await parseCslJson(path);
      setImportEntries(entries);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
      setImportEntries([]);
    }
  }

  // Import: save
  async function handleImport() {
    if (!effectiveBibPath || !workspacePath || importEntries.length === 0) return;
    setSaving(true);
    try {
      const outcomes = await saveBibEntries(importEntries, effectiveBibPath, workspacePath);
      const saved = outcomes.filter((o) => isSaved(o) || isSavedNoDoi(o)).length;
      const duplicates = outcomes.filter((o) => isDuplicateDoi(o)).length;
      const parts: string[] = [];
      if (saved > 0) parts.push(`${saved} saved`);
      if (duplicates > 0) parts.push(`${duplicates} duplicate${duplicates > 1 ? "s" : ""} skipped`);
      show(parts.join(", ") || "Import complete");
      onSaved();
    } catch (e) {
      show(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  // DOI input key handler
  function handleDoiKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && doi.trim() && !looking) {
      e.preventDefault();
      handleLookup();
    }
  }

  if (!open) return null;

  const hasResult = mode === "doi" ? lookupResult !== null : importEntries.length > 0;
  const canSave = hasResult && !!effectiveBibPath && !saving;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="add-reference-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[80vh] w-[32rem] flex-col rounded-lg bg-bg-primary"
        data-testid="add-reference-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="text-base font-semibold text-text-normal">Add Reference</h2>
          <button
            className="rounded p-1 text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="add-reference-close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 px-5 pb-3">
          <button
            data-testid="add-reference-mode-doi"
            className={`rounded px-3 py-1 text-sm ${mode === "doi" ? "bg-interactive-accent text-white" : "text-text-muted hover:bg-bg-secondary"}`}
            onClick={() => setMode("doi")}
          >
            DOI
          </button>
          <button
            data-testid="add-reference-mode-import"
            className={`rounded px-3 py-1 text-sm ${mode === "import" ? "bg-interactive-accent text-white" : "text-text-muted hover:bg-bg-secondary"}`}
            onClick={() => setMode("import")}
          >
            Import
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          {mode === "doi" ? (
            <>
              {/* DOI input */}
              <div>
                <label className="mb-1 block text-sm text-text-muted">DOI</label>
                <div className="flex gap-2">
                  <input
                    data-testid="add-reference-doi-input"
                    type="text"
                    className="flex-1 rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                    value={doi}
                    onChange={(e) => setDoi(e.target.value)}
                    onKeyDown={handleDoiKeyDown}
                    placeholder="e.g. 10.1000/xyz123"
                  />
                  <button
                    data-testid="add-reference-lookup-btn"
                    disabled={!doi.trim() || looking}
                    onClick={handleLookup}
                    className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {looking ? "Looking up..." : "Lookup"}
                  </button>
                </div>
              </div>

              {/* Loading */}
              {looking && (
                <div data-testid="add-reference-loading" className="text-sm text-text-muted">
                  Looking up DOI...
                </div>
              )}

              {/* Preview */}
              {lookupResult && (
                <div data-testid="add-reference-preview" className="rounded border border-border bg-bg-secondary p-3 text-sm">
                  <div className="font-semibold text-text-normal">{lookupResult.title}</div>
                  <div className="mt-1 text-text-muted">{lookupResult.authors.join("; ")}</div>
                  {lookupResult.year && <div className="text-text-muted">{lookupResult.year}</div>}
                  {lookupResult.journal && <div className="text-text-muted">{lookupResult.journal}</div>}
                  {lookupResult.doi && <div className="text-text-muted">{lookupResult.doi}</div>}
                </div>
              )}

              {/* Error */}
              {lookupError && (
                <div data-testid="add-reference-error" className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-error">
                  {lookupError}
                </div>
              )}
            </>
          ) : (
            <>
              {/* Import mode */}
              <div>
                <label className="mb-1 block text-sm text-text-muted">CSL-JSON File</label>
                <div className="flex items-center gap-2">
                  <button
                    data-testid="add-reference-import-file-btn"
                    onClick={handleChooseFile}
                    className="rounded border border-border px-3 py-1.5 text-sm text-text-normal hover:bg-bg-secondary"
                  >
                    Choose File
                  </button>
                  {importFile && (
                    <span className="truncate text-sm text-text-muted">{importFile}</span>
                  )}
                </div>
              </div>

              {/* Import preview */}
              {importEntries.length > 0 && (
                <div data-testid="add-reference-import-preview" className="max-h-48 space-y-1 overflow-y-auto rounded border border-border bg-bg-secondary p-3">
                  {importEntries.map((entry, i) => (
                    <div key={`${entry.key}-${i}`} className="text-sm">
                      <span className="text-text-normal">{entry.title}</span>
                      <span className="ml-2 text-text-muted">
                        {entry.authors.join("; ")}
                        {entry.year ? ` (${entry.year})` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Import error */}
              {importError && (
                <div data-testid="add-reference-error" className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-error">
                  {importError}
                </div>
              )}
            </>
          )}

          {/* Shared bib file picker */}
          <BibFilePicker
            bibFiles={bib.bibFiles}
            selectedBibFile={bib.selectedBibFile}
            onSelectedBibFileChange={bib.setSelectedBibFile}
            newBibPath={bib.newBibPath}
            onNewBibPathChange={bib.setNewBibPath}
            testIdPrefix="add-reference"
          />
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 pb-5 pt-3">
          <button
            data-testid="add-reference-cancel-btn"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
          >
            Cancel
          </button>
          <button
            data-testid="add-reference-save-btn"
            disabled={!canSave}
            onClick={mode === "doi" ? handleSave : handleImport}
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving
              ? mode === "doi"
                ? "Saving..."
                : "Importing..."
              : mode === "doi"
                ? "Save"
                : `Import ${importEntries.length > 0 ? `(${importEntries.length})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
