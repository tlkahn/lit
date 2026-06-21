import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useOverflowMenu } from "../hooks/useOverflowMenu";
import { usePaneStore, collectLeaves, findLeaf, getPanePosition } from "../stores/panes";

export function BufferStack() {
  const root = usePaneStore((s) => s.root);
  const focusedPaneId = usePaneStore((s) => s.focusedPaneId);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [animatedIn, setAnimatedIn] = useState(false);
  const hasBeenOpenRef = useRef(false);

  const leaves = collectLeaves(root);
  const openBuffers = leaves.filter((l) => l.pagePath !== null);
  const shouldShowChip = openBuffers.length > 1;

  const { open, setOpen, triggerRef, menuRef } = useOverflowMenu({
    anchor: "above-left",
    dismissOnScroll: false,
    onResize: true,
    extraDeps: [leaves.length],
  });

  useEffect(() => {
    if (!shouldShowChip) setOpen(false);
  }, [shouldShowChip]);

  useEffect(() => {
    if (open) {
      hasBeenOpenRef.current = true;
      const focusedIdx = leaves.findIndex((l) => l.id === focusedPaneId);
      setHighlightedIndex(focusedIdx >= 0 ? focusedIdx : 0);
      setAnimatedIn(false);
      const t = setTimeout(() => setAnimatedIn(true), 0);
      return () => clearTimeout(t);
    } else if (hasBeenOpenRef.current) {
      setAnimatedIn(false);
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (open && menuRef.current) {
      menuRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    setHighlightedIndex((prev) => Math.min(prev, Math.max(leaves.length - 1, 0)));
  }, [leaves.length]);

  if (openBuffers.length === 0) return null;

  const focusedLeaf = findLeaf(root, focusedPaneId);
  const displayPath =
    focusedLeaf?.pagePath ?? openBuffers[0]!.pagePath!;
  const otherCount = openBuffers.length - 1;

  if (otherCount === 0) {
    return (
      <span className="flex items-center gap-1">
        <span data-testid="buffer-stack-label" title={displayPath} className="truncate max-w-[200px]">{displayPath}</span>
        <button
          data-testid={`buffer-stack-close-${focusedLeaf?.id}`}
          className="text-text-faint hover:text-text-normal"
          onClick={() => {
            if (focusedLeaf) usePaneStore.getState().closePane(focusedLeaf.id);
          }}
        >
          ×
        </button>
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        data-testid="buffer-stack-chip"
        className="flex items-center gap-1"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Buffer list"
        onClick={() => setOpen((v) => !v)}
      >
        <span data-testid="buffer-stack-label" title={displayPath} className="truncate max-w-[200px]">{displayPath}</span>
        <span data-testid="buffer-stack-count">(+{otherCount})</span>
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          data-testid="buffer-stack-popover"
          role="listbox"
          tabIndex={0}
          aria-activedescendant={`buffer-option-${leaves[highlightedIndex]?.id}`}
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            opacity: animatedIn ? 1 : 0,
            transform: animatedIn ? "translateY(0)" : "translateY(4px)",
            transition: "opacity 100ms ease-out, transform 100ms ease-out",
          }}
          className="z-50 min-w-[200px] select-none rounded-lg border border-border/20 bg-bg-primary/80 p-1 shadow-lg shadow-black/10 backdrop-blur-xl backdrop-saturate-150 outline-none dark:border-border/10 dark:bg-bg-primary/70"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev + 1) % leaves.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex((prev) => (prev - 1 + leaves.length) % leaves.length);
            } else if (e.key === "Enter") {
              e.preventDefault();
              const leaf = leaves[highlightedIndex];
              if (leaf) {
                usePaneStore.getState().focusPane(leaf.id);
                setOpen(false);
              }
            } else if (e.key === "Tab") {
              const closeButtons = menuRef.current?.querySelectorAll<HTMLElement>('[data-testid^="buffer-stack-close-"]');
              if (!closeButtons?.length) return;
              const first = closeButtons[0]!;
              const last = closeButtons[closeButtons.length - 1]!;
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              } else if (e.shiftKey && document.activeElement === menuRef.current) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === menuRef.current) {
                e.preventDefault();
                first.focus();
              }
            }
          }}
        >
          {leaves.map((leaf, idx) => {
            const isActive = leaf.id === focusedPaneId;
            const isHighlighted = idx === highlightedIndex;
            const label = leaf.pagePath
              ? leaf.pagePath.split("/").pop()
              : "(empty)";
            const pos = getPanePosition(root, leaf.id);
            return (
              <div
                key={leaf.id}
                id={`buffer-option-${leaf.id}`}
                data-testid={`buffer-stack-row-${leaf.id}`}
                role="option"
                aria-selected={isActive}
                className={`flex w-full cursor-pointer items-center justify-between rounded-md px-3 py-1 text-[13px] text-text-normal hover:bg-bg-hover ${
                  isActive
                    ? "border-l-2 border-interactive-accent bg-interactive-accent/10"
                    : ""
                }${isHighlighted && !isActive ? " bg-bg-hover" : ""}`}
                onClick={() => {
                  usePaneStore.getState().focusPane(leaf.id);
                  setOpen(false);
                }}
              >
                <span className="flex items-center gap-1">
                  <span
                    data-testid={`buffer-stack-filename-${leaf.id}`}
                    title={leaf.pagePath ?? "(empty)"}
                    className="truncate max-w-[200px]"
                  >{label}</span>
                  {pos && (
                    <span
                      data-testid={`buffer-stack-position-${leaf.id}`}
                      className="text-[11px] text-text-faint"
                    >
                      {pos}
                    </span>
                  )}
                </span>
                {(leaves.length > 1 || leaf.pagePath !== null) && (
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
