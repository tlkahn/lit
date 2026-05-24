import { useEffect, useCallback } from "react";
import type { SplitPlan } from "../lib/ipc";

export function computeOutputPath(originalPath: string, sectionTitle: string): string {
  const dir = originalPath.substring(0, originalPath.lastIndexOf("/") + 1);
  const safeName = sectionTitle.replace(/[/\\:*?"<>|]/g, "_");
  return `${dir}${safeName}.md`;
}

interface SplitPreviewDialogProps {
  open: boolean;
  plan: SplitPlan;
  originalPath: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function previewBody(body: string): string {
  return body.split("\n").slice(0, 3).join("\n");
}

export function SplitPreviewDialog({
  open,
  plan,
  originalPath,
  onConfirm,
  onCancel,
}: SplitPreviewDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    },
    [onCancel],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  const items: Array<{ title: string; body: string; path: string; isPreamble: boolean }> = [];

  if (plan.preamble) {
    items.push({
      title: plan.preamble.title,
      body: plan.preamble.body,
      path: computeOutputPath(originalPath, plan.preamble.title),
      isPreamble: true,
    });
  }

  for (const section of plan.sections) {
    items.push({
      title: section.title,
      body: section.body,
      path: computeOutputPath(originalPath, section.title),
      isPreamble: false,
    });
  }

  const pathCounts = new Map<string, number>();
  for (const item of items) {
    pathCounts.set(item.path, (pathCounts.get(item.path) ?? 0) + 1);
  }
  const duplicatePaths = [...pathCounts.entries()].filter(([, c]) => c > 1).map(([p]) => p);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="split-preview-backdrop"
    >
      <div
        className="w-[32rem] max-h-[80vh] overflow-y-auto rounded-lg bg-bg-primary p-5 shadow-lg"
        data-testid="split-preview-dialog"
      >
        <h2 className="mb-4 text-base font-medium text-text-normal">Split Preview</h2>

        {duplicatePaths.length > 0 && (
          <div
            className="mb-2 rounded bg-amber-100 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
            data-testid="split-duplicate-path-warning"
          >
            Duplicate output paths: {duplicatePaths.join(", ")}
          </div>
        )}

        <div className="mb-4 flex flex-col gap-2" data-testid="split-section-list">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded border border-border-primary bg-bg-secondary px-3 py-2"
              data-testid="split-section-item"
            >
              <div className="flex items-center gap-2">
                <svg className="h-4 w-4 shrink-0 text-text-muted" data-testid="split-file-icon" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M3 1h7l4 4v10H3V1zm7 1v3h3L10 2zM4 2v12h8V6h-4V2H4z" />
                </svg>
                <span className="text-sm font-medium text-text-normal">{item.title}</span>
              </div>
              <div className="mt-1 text-xs text-text-muted" data-testid="split-output-path">
                {item.path}
              </div>
              {item.body && (
                <pre className="mt-1 whitespace-pre-wrap text-xs text-text-muted opacity-70" data-testid="split-body-preview">
                  {previewBody(item.body)}
                </pre>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onCancel}
            data-testid="split-cancel-btn"
          >
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:opacity-90"
            onClick={onConfirm}
            data-testid="split-confirm-btn"
          >
            Split
          </button>
        </div>
      </div>
    </div>
  );
}
