import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useModalLock } from "../hooks/useModalLock";
import {
  type BibEntry,
  type OcrProgressPayload,
  ocrPdfToMarkdown,
  checkOcrTargetExists,
} from "../lib/ipc";

interface OcrDialogProps {
  entry: BibEntry;
  workspacePath: string;
  onClose: () => void;
  onComplete: (resultPath: string) => void;
}

export function OcrDialog({ entry, workspacePath, onClose, onComplete }: OcrDialogProps) {
  const [leadSkip, setLeadSkip] = useState(0);
  const [trailSkip, setTrailSkip] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [progressDetail, setProgressDetail] = useState<string | null>(null);
  const [overwriteConfirm, setOverwriteConfirm] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, true);
  useModalLock(true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !processing && !overwriteConfirm) {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [onClose, processing, overwriteConfirm]);

  const processingRef = useRef(false);
  processingRef.current = processing;

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<OcrProgressPayload>(
      "lit:ocr-progress",
      (event) => {
        if (cancelled || !processingRef.current) return;
        if (event.payload.key === entry.key) {
          setProgressStep(event.payload.step);
          setProgressDetail(event.payload.detail ?? null);
        }
      },
    ).then((fn) => {
      if (cancelled) { fn(); } else { unlisten = fn; }
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [entry.key]);

  async function handleStartOcr(overwrite = false) {
    setError(null);
    setProcessing(true);
    setProgressStep(null);
    setProgressDetail(null);
    setOverwriteConfirm(false);

    try {
      if (!overwrite) {
        const exists = await checkOcrTargetExists(entry.key, workspacePath);
        if (exists) {
          setProcessing(false);
          setOverwriteConfirm(true);
          return;
        }
      }

      const resultPath = await ocrPdfToMarkdown(entry.key, workspacePath, {
        lead: leadSkip,
        trail: trailSkip,
        overwrite,
      });
      onComplete(resultPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setProcessing(false);
      setProgressStep(null);
      setProgressDetail(null);
    }
  }

  function handleConfirmOverwrite() {
    handleStartOcr(true);
  }

  function handleCancelOverwrite() {
    setOverwriteConfirm(false);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="ocr-dialog-backdrop"
      onClick={() => { if (!processing && !overwriteConfirm) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ocr-dialog-title"
        className="flex max-h-[80vh] w-[28rem] flex-col rounded-lg bg-bg-primary"
        data-testid="ocr-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 id="ocr-dialog-title" className="text-base font-semibold text-text-normal">
            OCR to Markdown
          </h2>
          <button
            className="rounded p-1 text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            disabled={processing}
            aria-label="Close dialog"
            data-testid="ocr-dialog-close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 pb-5">
          <div className="rounded border border-border bg-bg-secondary p-3 text-sm" data-testid="ocr-entry-info">
            <div className="font-semibold text-text-normal">{entry.title}</div>
            <div className="mt-1 text-text-muted">@{entry.key}</div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label htmlFor="ocr-lead-skip" className="mb-1 block text-sm text-text-muted">
                Lead pages to skip
              </label>
              <input
                id="ocr-lead-skip"
                data-testid="ocr-lead-skip"
                type="number"
                min={0}
                value={leadSkip}
                onChange={(e) => setLeadSkip(Math.max(0, parseInt(e.target.value) || 0))}
                disabled={processing}
                className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="ocr-trail-skip" className="mb-1 block text-sm text-text-muted">
                Trail pages to skip
              </label>
              <input
                id="ocr-trail-skip"
                data-testid="ocr-trail-skip"
                type="number"
                min={0}
                value={trailSkip}
                onChange={(e) => setTrailSkip(Math.max(0, parseInt(e.target.value) || 0))}
                disabled={processing}
                className="w-full rounded border border-border bg-bg-secondary px-3 py-1.5 text-sm text-text-normal"
              />
            </div>
          </div>

          {overwriteConfirm && (
            <div className="rounded border border-border bg-bg-secondary p-3 text-sm" data-testid="ocr-overwrite-confirm">
              <p className="text-text-normal">
                A markdown file already exists for this entry. Overwrite it?
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  data-testid="ocr-overwrite-yes"
                  onClick={handleConfirmOverwrite}
                  className="rounded bg-interactive-accent px-3 py-1 text-sm text-white hover:opacity-90"
                >
                  Overwrite
                </button>
                <button
                  data-testid="ocr-overwrite-no"
                  onClick={handleCancelOverwrite}
                  className="rounded px-3 py-1 text-sm text-text-muted hover:bg-bg-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {processing && progressStep && (
            <div className="space-y-1 text-sm" data-testid="ocr-progress">
              <div className="font-medium text-text-normal">{progressStep}</div>
              {progressDetail && (
                <div className="text-text-muted">{progressDetail}</div>
              )}
            </div>
          )}

          {error && (
            <div
              className="rounded border border-border bg-bg-secondary p-3 text-sm text-text-error"
              data-testid="ocr-error"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5 pt-3">
          <button
            data-testid="ocr-cancel-btn"
            onClick={onClose}
            disabled={processing}
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
          >
            Cancel
          </button>
          <button
            data-testid="ocr-start-btn"
            disabled={processing || overwriteConfirm}
            onClick={() => handleStartOcr(false)}
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
          >
            {processing ? "Processing..." : "Start OCR"}
          </button>
        </div>
      </div>
    </div>
  );
}
