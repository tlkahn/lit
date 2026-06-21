import { useEffect } from "react";
import { useWorkspaceStore } from "../stores/workspace";
import { showTrashContextMenu, useTrashContextMenu } from "../lib/contextMenuIpc";

export function TrashPanel() {
  const trashItems = useWorkspaceStore((s) => s.trashItems);
  const loadTrash = useWorkspaceStore((s) => s.loadTrash);
  const restorePage = useWorkspaceStore((s) => s.restorePage);
  const purgePage = useWorkspaceStore((s) => s.purgePage);
  const emptyTrash = useWorkspaceStore((s) => s.emptyTrash);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  useTrashContextMenu({
    onRestore: (trashName) => restorePage(trashName),
    onPurge: (trashName) => purgePage(trashName),
  });

  if (trashItems.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-xs text-text-faint">
        Trash is empty
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border-subtle px-2 py-1">
        <span className="text-xs text-text-muted">{trashItems.length} item{trashItems.length !== 1 ? "s" : ""}</span>
        <button
          onClick={() => {
            if (!window.confirm("Permanently delete all items in Trash?")) return;
            emptyTrash();
          }}
          data-testid="empty-trash-btn"
          className="rounded px-2 py-0.5 text-xs text-text-error hover:bg-destructive hover:text-text-on-accent"
        >
          Empty Trash
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1">
        {trashItems.map((item) => (
          <div
            key={item.trash_name}
            className="group relative"
            onContextMenu={(e) => {
              e.preventDefault();
              showTrashContextMenu(item.trash_name);
            }}
          >
            <div
              className="w-full select-none truncate rounded px-2 py-1 text-start text-xs text-text-normal hover:bg-bg-hover"
              title={item.original_path}
            >
              {item.original_path}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
