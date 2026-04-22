import { useEffect, useCallback } from "react";

interface ConflictDialogProps {
  open: boolean;
  onKeepMine: () => void;
  onReload: () => void;
}

export function ConflictDialog({ open, onKeepMine, onReload }: ConflictDialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onKeepMine();
    },
    [onKeepMine],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="conflict-dialog-backdrop"
    >
      <div className="w-80 rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="conflict-dialog">
        <p className="mb-4 text-sm text-text-normal">
          This file was modified externally. You have unsaved changes.
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onKeepMine}
            data-testid="conflict-keep-mine"
          >
            Keep mine
          </button>
          <button
            className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-white hover:opacity-90"
            onClick={onReload}
            data-testid="conflict-reload"
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
