import { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceStore } from "../stores/workspace";

export function TrashPanel() {
  const trashItems = useWorkspaceStore((s) => s.trashItems);
  const loadTrash = useWorkspaceStore((s) => s.loadTrash);
  const restorePage = useWorkspaceStore((s) => s.restorePage);
  const purgePage = useWorkspaceStore((s) => s.purgePage);
  const emptyTrash = useWorkspaceStore((s) => s.emptyTrash);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const [menuTrashName, setMenuTrashName] = useState<string | null>(null);
  const menuPosRef = useRef({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  const handleMenuClose = useCallback(() => setMenuTrashName(null), []);

  useEffect(() => {
    if (!menuTrashName) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        handleMenuClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleMenuClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuTrashName, handleMenuClose]);

  if (trashItems.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-text-faint">
        Trash is empty
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
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
              menuPosRef.current = { x: e.clientX, y: e.clientY };
              setMenuTrashName(item.trash_name);
            }}
          >
            <div
              className="w-full truncate rounded px-2 py-1 text-start text-sm text-text-normal hover:bg-bg-hover"
              title={item.original_path}
            >
              {item.original_path}
            </div>
            {menuTrashName === item.trash_name && createPortal(
              <div
                ref={menuRef}
                data-testid="trash-context-menu"
                className="z-50 min-w-[160px] select-none rounded-lg border border-border/40 bg-bg-primary/80 p-1 shadow-xl shadow-black/20 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
                style={{ position: "fixed", left: `${menuPosRef.current.x}px`, top: `${menuPosRef.current.y}px` }}
              >
                <button
                  onClick={() => {
                    handleMenuClose();
                    restorePage(item.trash_name);
                  }}
                  className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-normal hover:bg-interactive-accent hover:text-text-on-accent"
                >
                  Restore
                </button>
                <button
                  onClick={() => {
                    handleMenuClose();
                    purgePage(item.trash_name);
                  }}
                  className="block w-full rounded-md px-3 py-1 text-start text-[13px] text-text-error hover:bg-destructive hover:text-text-on-accent"
                >
                  Delete Permanently
                </button>
              </div>,
              document.body,
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
