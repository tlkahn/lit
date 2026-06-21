import { useEffect, useCallback } from "react";
import type { ConflictEntry } from "../lib/conflictDetection";
import type { Platform } from "../lib/keyChordFormat";
import { KeyChord } from "./KeyChord";

interface ConflictResolutionDialogProps {
  open: boolean;
  newKey: string;
  newCommandLabel: string;
  conflicts: ConflictEntry[];
  platform: Platform;
  onRebind: () => void;
  onCancel: () => void;
}

export function ConflictResolutionDialog({
  open,
  newKey,
  newCommandLabel,
  conflicts,
  platform,
  onRebind,
  onCancel,
}: ConflictResolutionDialogProps) {
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

  const isMenuConflict = conflicts.some((c) => c.binding.source === "menu");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="conflict-dialog-backdrop"
    >
      <div className="w-96 rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="conflict-dialog">
        <p className="mb-3 text-sm text-text-normal">
          <KeyChord chord={newKey} platform={platform} /> for &ldquo;{newCommandLabel}&rdquo; is already assigned to:
        </p>
        <ul className="mb-4 space-y-1">
          {conflicts.map((c) => (
            <li key={c.binding.command} className="text-sm font-medium text-text-normal">
              {c.label}
            </li>
          ))}
        </ul>

        {isMenuConflict && (
          <p className="mb-4 text-xs text-text-muted">Menu shortcuts cannot be rebound</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onCancel}
            data-testid="conflict-cancel-btn"
          >
            Cancel
          </button>
          {!isMenuConflict && (
            <button
              className="rounded bg-interactive-accent px-3 py-1.5 text-sm text-text-on-accent hover:opacity-90"
              onClick={onRebind}
              data-testid="conflict-rebind-btn"
            >
              Rebind
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
