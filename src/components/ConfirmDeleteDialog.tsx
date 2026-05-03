import { useEffect, useCallback } from "react";

interface ConfirmDeleteDialogProps {
  open: boolean;
  nodeName: string;
  childCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDeleteDialog({ open, nodeName, childCount, onConfirm, onCancel }: ConfirmDeleteDialogProps) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="confirm-delete-backdrop"
    >
      <div className="w-80 rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="confirm-delete-dialog">
        <p className="mb-4 text-sm text-text-normal">
          Delete &quot;{nodeName}&quot; and its {childCount} {childCount === 1 ? "child" : "children"}?
        </p>
        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onCancel}
            data-testid="confirm-delete-cancel"
          >
            Cancel
          </button>
          <button
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:opacity-90"
            onClick={onConfirm}
            data-testid="confirm-delete-btn"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
