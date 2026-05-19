import { useState, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { usePaneStore, collectLeaves, findLeaf } from "../stores/panes";

export function BufferStack() {
  const root = usePaneStore((s) => s.root);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const leaves = collectLeaves(root);
  const openBuffers = leaves.filter((l) => l.pagePath !== null);
  const shouldShowChip = openBuffers.length > 1;

  useEffect(() => {
    if (!shouldShowChip) setOpen(false);
  }, [shouldShowChip]);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (
        buttonRef.current && !buttonRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !popoverRef.current || !buttonRef.current) return;
    const position = () => {
      if (!popoverRef.current || !buttonRef.current) return;
      const btnRect = buttonRef.current.getBoundingClientRect();
      const menu = popoverRef.current;
      const rect = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      let left = btnRect.left;
      let top = btnRect.top - rect.height - 4;
      if (left + rect.width > vw) left = vw - rect.width;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open, leaves.length]);

  if (openBuffers.length === 0) return null;

  const focusedLeaf = findLeaf(root, focusedPaneId);
  const displayPath =
    focusedLeaf?.pagePath ?? openBuffers[0]!.pagePath!;
  const otherCount = openBuffers.length - 1;

  if (otherCount === 0) {
    return <span data-testid="buffer-stack-label">{displayPath}</span>;
  }

  return (
    <>
      <button
        ref={buttonRef}
        data-testid="buffer-stack-chip"
        className="flex items-center gap-1"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span data-testid="buffer-stack-label">{displayPath}</span>
        <span data-testid="buffer-stack-count">(+{otherCount})</span>
      </button>
      {open && createPortal(
        <div
          ref={popoverRef}
          data-testid="buffer-stack-popover"
          role="listbox"
          style={{ position: "fixed", left: 0, top: 0 }}
          className="z-50 min-w-[200px] select-none rounded-lg border border-border/40 bg-bg-primary/80 p-1 shadow-xl shadow-black/20 backdrop-blur-xl backdrop-saturate-150 dark:border-border/10 dark:bg-bg-primary/70"
        >
          {leaves.map((leaf) => {
            const isActive = leaf.id === focusedPaneId;
            const label = leaf.pagePath
              ? leaf.pagePath.split("/").pop()
              : "(empty)";
            return (
              <div
                key={leaf.id}
                data-testid={`buffer-stack-row-${leaf.id}`}
                role="option"
                aria-selected={isActive}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1 text-[13px] text-text-normal hover:bg-bg-hover ${
                  isActive
                    ? "border-l-2 border-interactive-accent bg-interactive-accent/10"
                    : ""
                }`}
                onClick={() => {
                  usePaneStore.getState().focusPane(leaf.id);
                  setOpen(false);
                }}
              >
                <span>{label}</span>
                {leaves.length > 1 && (
                  <button
                    data-testid={`buffer-stack-close-${leaf.id}`}
                    className="ml-2 text-text-faint hover:text-text-normal"
                    onClick={(e) => {
                      e.stopPropagation();
                      usePaneStore.getState().closePane(leaf.id);
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
