import { useState, useEffect, useCallback, useRef } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useWorkspaceStore } from "../stores/workspace";
import { useStatusMessageStore } from "../stores/statusMessage";
import {
  recognizePdf,
  importRecognizedEntry,
  isSaved,
  isDuplicateDoi,
  isSavedNoDoi,
  type BibEntry,
  type SaveOutcome,
  type RecognizeResult,
  type ConfirmReason,
} from "../lib/ipc";
import { SpinnerSvg } from "./SpinnerSvg";

type DialogPhase = "idle" | "progress" | "confirm" | "error";

interface ImportPdfDialogProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  /** If provided, skip idle state and go straight to recognition with this path. */
  initialPdfPath?: string | null;
}

function reasonBannerText(reason: ConfirmReason, message: string | null): string {
  switch (reason) {
    case "no_text_layer":
      return "This PDF has no text layer.";
    case "no_identifier":
    case "no_match":
      return "Couldn't find a confident match -- please confirm details.";
    case "offline_error":
      return message ?? "An error occurred while trying to resolve.";
  }
}

export function ImportPdfDialog({ open, onClose, onImported, initialPdfPath }: ImportPdfDialogProps) {
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const show = useStatusMessageStore((s) => s.show);

  const [phase, setPhase] = useState<DialogPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // For confirm form
  const [confirmData, setConfirmData] = useState<
    (RecognizeResult & { kind: "needs_confirmation" }) | null
  >(null);
  const [editFields, setEditFields] = useState({
    entry_type: "misc",
    title: "",
    authors: "",
    year: "",
    journal: "",
    doi: "",
  });
  const [saving, setSaving] = useState(false);

  // Track the chosen PDF path for retries
  const [pdfPath, setPdfPath] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, open);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setPhase("idle");
      setError(null);
      setConfirmData(null);
      setEditFields({
        entry_type: "misc",
        title: "",
        authors: "",
        year: "",
        journal: "",
        doi: "",
      });
      setSaving(false);
      setPdfPath(null);

      // Pre-seed PDF path from drag-drop
      if (initialPdfPath) {
        setPdfPath(initialPdfPath);
      }
    }
  }, [open, initialPdfPath]);

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

  // Shared SaveOutcome dispatch
  function handleSaveOutcome(outcome: SaveOutcome) {
    if (isDuplicateDoi(outcome)) {
      show(
        `DOI already exists as @${outcome.DuplicateDoi.existing_key}`,
        "error",
      );
      onClose();
    } else if (isSaved(outcome)) {
      show(`Imported as @${outcome.Saved.key}`);
      onImported();
    } else if (isSavedNoDoi(outcome)) {
      show(`Imported as @${outcome.SavedNoDoi.key} (no DOI)`);
      onImported();
    }
  }

  // Handle the result of recognizePdf
  function handleRecognizeResult(result: RecognizeResult) {
    if (result.kind === "resolved") {
      handleSaveOutcome(result.outcome);
    } else if (result.kind === "needs_confirmation") {
      setPhase("confirm");
      setConfirmData(result);
      const p = result.prefilled;
      setEditFields({
        entry_type: p.entry_type || "misc",
        title: p.title || "",
        authors: p.authors.join("; "),
        year: p.year || "",
        journal: p.journal || "",
        doi: p.doi || "",
      });
    }
  }

  // Start recognition flow
  async function startRecognition(chosenPdfPath: string) {
    if (!workspacePath) return;
    setPhase("progress");
    setError(null);
    show("Recognizing PDF...", "progress");
    try {
      const result = await recognizePdf(chosenPdfPath, workspacePath);
      handleRecognizeResult(result);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Auto-start recognition when pre-seeded via drag-drop
  const autoStartFired = useRef(false);
  useEffect(() => {
    if (
      open &&
      initialPdfPath &&
      pdfPath === initialPdfPath &&
      phase === "idle" &&
      !autoStartFired.current
    ) {
      autoStartFired.current = true;
      startRecognition(initialPdfPath);
    }
    if (!open) {
      autoStartFired.current = false;
    }
  }, [open, pdfPath, phase, initialPdfPath]);

  // Choose PDF and start recognition
  async function handleChoosePdf() {
    try {
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const path = await openDialog({
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path || typeof path !== "string") return;
      setPdfPath(path);
      await startRecognition(path);
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Retry recognition with the same PDF path
  async function handleRetry() {
    if (!pdfPath) return;
    await startRecognition(pdfPath);
  }

  // Save confirmed entry
  async function handleConfirmSave() {
    if (!confirmData || !workspacePath) return;
    setSaving(true);
    setError(null);
    try {
      const entry: BibEntry = {
        ...confirmData.prefilled,
        authors: editFields.authors
          .split(";")
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
        title: editFields.title,
        year: editFields.year,
        entry_type: editFields.entry_type,
        line_number: 0,
        doi: editFields.doi || undefined,
        journal: editFields.journal || undefined,
        file: confirmData.file,
      };
      const outcomes = await importRecognizedEntry(entry, workspacePath);
      const first = outcomes[0];
      if (first) {
        handleSaveOutcome(first);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="import-pdf-backdrop"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        className="flex max-h-[80vh] w-[32rem] flex-col rounded-lg bg-bg-primary"
        data-testid="import-pdf-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="text-base font-semibold text-text-normal">Import PDF</h2>
          <button
            className="rounded p-1 text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="import-pdf-close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          {/* Error banner (shown in error phase and confirm-save errors) */}
          {error && (phase === "error" || phase === "confirm") && (
            <div
              data-testid="import-pdf-error-banner"
              className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-error"
            >
              {error}
            </div>
          )}

          {/* Idle phase */}
          {phase === "idle" && (
            <div>
              <button
                data-testid="import-pdf-choose-btn"
                onClick={handleChoosePdf}
                className="rounded border border-border px-3 py-1.5 text-sm text-text-normal hover:bg-bg-secondary"
              >
                Choose PDF...
              </button>
            </div>
          )}

          {/* Progress phase */}
          {phase === "progress" && (
            <div className="flex items-center gap-2 py-4">
              <SpinnerSvg className="h-5 w-5 text-interactive-accent" />
              <span data-testid="import-pdf-spinner" className="text-sm text-text-muted">
                Recognizing PDF...
              </span>
            </div>
          )}

          {/* Confirm phase */}
          {phase === "confirm" && confirmData && (
            <>
              {/* Reason banner */}
              <div
                data-testid="import-pdf-reason-banner"
                className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-muted"
              >
                {reasonBannerText(confirmData.reason, confirmData.message)}
              </div>

              {/* Retry button for offline_error */}
              {confirmData.reason === "offline_error" && (
                <button
                  data-testid="import-pdf-retry-btn"
                  onClick={handleRetry}
                  className="rounded border border-border px-3 py-1.5 text-sm text-text-normal hover:bg-bg-secondary"
                >
                  Retry
                </button>
              )}

              {/* Editable fields */}
              <div>
                <label className="mb-1 block text-sm text-text-muted">Entry type</label>
                <select
                  data-testid="import-pdf-field-entry-type"
                  className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                  value={editFields.entry_type}
                  onChange={(e) => setEditFields((f) => ({ ...f, entry_type: e.target.value }))}
                >
                  <option value="article">article</option>
                  <option value="book">book</option>
                  <option value="inproceedings">inproceedings</option>
                  <option value="phdthesis">phdthesis</option>
                  <option value="misc">misc</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm text-text-muted">Title</label>
                <input
                  data-testid="import-pdf-field-title"
                  type="text"
                  className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                  value={editFields.title}
                  onChange={(e) => setEditFields((f) => ({ ...f, title: e.target.value }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-text-muted">Authors (semicolon-separated)</label>
                <input
                  data-testid="import-pdf-field-authors"
                  type="text"
                  className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                  value={editFields.authors}
                  onChange={(e) => setEditFields((f) => ({ ...f, authors: e.target.value }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-text-muted">Year</label>
                <input
                  data-testid="import-pdf-field-year"
                  type="text"
                  className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                  value={editFields.year}
                  onChange={(e) => setEditFields((f) => ({ ...f, year: e.target.value }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-text-muted">Journal</label>
                <input
                  data-testid="import-pdf-field-journal"
                  type="text"
                  className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                  value={editFields.journal}
                  onChange={(e) => setEditFields((f) => ({ ...f, journal: e.target.value }))}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-text-muted">DOI</label>
                <input
                  data-testid="import-pdf-field-doi"
                  type="text"
                  className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
                  value={editFields.doi}
                  onChange={(e) => setEditFields((f) => ({ ...f, doi: e.target.value }))}
                />
              </div>
            </>
          )}

          {/* Error phase (different from confirm-phase error) */}
          {phase === "error" && (
            <button
              data-testid="import-pdf-retry-btn"
              onClick={handleRetry}
              className="rounded border border-border px-3 py-1.5 text-sm text-text-normal hover:bg-bg-secondary"
            >
              Retry
            </button>
          )}

        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 pb-5 pt-3">
          <button
            data-testid="import-pdf-cancel-btn"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
          >
            Cancel
          </button>
          {phase === "confirm" && (
            <button
              data-testid="import-pdf-confirm-save-btn"
              disabled={saving}
              onClick={handleConfirmSave}
              className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
