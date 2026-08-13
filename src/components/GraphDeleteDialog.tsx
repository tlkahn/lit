import { useGraphSelectionStore } from "../stores/graphSelection";
import { useWorkspaceStore } from "../stores/workspace";

interface GraphDeleteDialogProps {
  deleteConfirm: { nodeIds: string[]; labels: string[] } | null;
  onClose: () => void;
}

export function GraphDeleteDialog({ deleteConfirm, onClose }: GraphDeleteDialogProps) {
  const deletePageAction = useWorkspaceStore((s) => s.deletePage);

  if (!deleteConfirm) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="confirm-delete-backdrop"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      <div className="w-80 rounded-lg bg-bg-primary p-5 shadow-lg" data-testid="confirm-delete-dialog">
        <p className="mb-4 text-sm text-text-normal">
          {deleteConfirm.nodeIds.length === 1
            ? <>Move &quot;{deleteConfirm.labels[0]}&quot; to trash?</>
            : <>Move {deleteConfirm.nodeIds.length} documents to trash?</>}
        </p>
        {deleteConfirm.nodeIds.length > 1 && (
          <ul className="mb-4 max-h-32 overflow-y-auto text-xs text-text-muted list-disc pl-4">
            {deleteConfirm.labels.map((label, i) => <li key={deleteConfirm.nodeIds[i]}>{label}</li>)}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <button
            className="rounded px-3 py-1.5 text-sm text-text-muted hover:bg-bg-secondary"
            onClick={onClose}
            data-testid="confirm-delete-cancel"
          >
            Cancel
          </button>
          <button
            className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:opacity-90"
            data-testid="confirm-delete-btn"
            onClick={async () => {
              const ids = deleteConfirm.nodeIds;
              onClose();
              useGraphSelectionStore.getState().clearSelection();
              for (const id of ids) {
                try {
                  await deletePageAction(id);
                } catch {
                  // Best-effort continue: a failed trash must not abort the
                  // remaining deletes. The store still records `error`.
                }
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
