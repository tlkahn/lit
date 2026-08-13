interface TrashPagesDialogProps {
  paths: string[];
  labels: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Presentational confirm for trashing one or more sidebar pages. The parent
 * owns the actual delete loop (see Sidebar requestTrash/runTrash); this dialog
 * only renders copy and fires onConfirm/onCancel.
 */
export function TrashPagesDialog({ paths, labels, onCancel, onConfirm }: TrashPagesDialogProps) {
  if (paths.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="confirm-delete-backdrop"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <div className="w-80 rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="confirm-delete-dialog">
        <p className="mb-4 text-sm text-text-normal">
          {paths.length === 1
            ? <>Move &quot;{labels[0]}&quot; to trash?</>
            : <>Move {paths.length} pages to trash?</>}
        </p>
        {paths.length > 1 && (
          <ul className="mb-4 max-h-32 overflow-y-auto text-xs text-text-muted list-disc pl-4">
            {labels.map((label, i) => <li key={paths[i]}>{label}</li>)}
          </ul>
        )}
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
            data-testid="confirm-delete-btn"
            onClick={onConfirm}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
