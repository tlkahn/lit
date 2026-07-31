import { useCallback, useEffect, useRef } from "react";
import { useModalLockStore } from "../stores/modalLock";

interface UseCardboxKeyboardOptions {
  onExpand: (index: number) => void;
  onNavigate: (index: number) => void;
  onOpenLinkPicker?: () => void;
  onTogglePin?: (index: number) => void;
  onToggleNote?: () => void;
  onToggleScope?: () => void;
  // Returns true when it consumed the key (a quotable selection existed).
  onQuoteSelection?: () => boolean;
  onShowConnections?: () => void;
  onExitConnections?: () => void;
  onShowShortcuts?: () => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  expandedUuid: string | null;
  connectionsActive?: boolean;
  itemCount: number;
}

export function useCardboxKeyboard({ onExpand, onNavigate, onOpenLinkPicker, onTogglePin, onToggleNote, onToggleScope, onQuoteSelection, onShowConnections, onExitConnections, onShowShortcuts, onSelectAll, onClearSelection, onUndo, onRedo, expandedUuid, connectionsActive, itemCount }: UseCardboxKeyboardOptions) {
  const gridRef = useRef<HTMLDivElement>(null);

  const getColumnCount = useCallback(() => {
    const grid = gridRef.current;
    if (!grid || !grid.firstElementChild) return 1;
    const gridWidth = grid.clientWidth;
    // Each column is minmax(280px, 1fr) with 16px gap
    return Math.max(1, Math.floor((gridWidth + 16) / (280 + 16)));
  }, []);

  // Global layer: Cmd+Z, Cmd+Shift+Z/Ctrl+Y, Cmd+A work regardless of focus
  const globalHandler = useCallback((e: KeyboardEvent) => {
    // Skip when a modal is open
    if (useModalLockStore.getState().locked) return;

    // Skip when focus is in an input/textarea/contentEditable
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || (document.activeElement as HTMLElement)?.isContentEditable) return;

    // Cmd+Z: undo
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "z") {
      e.preventDefault();
      e.stopPropagation();
      onUndo?.();
      return;
    }

    // Cmd+Shift+Z or Ctrl+Y: redo
    if (((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "z") ||
        (e.ctrlKey && e.key === "y")) {
      e.preventDefault();
      e.stopPropagation();
      onRedo?.();
      return;
    }

    // Cmd/Ctrl+A: select all
    if ((e.metaKey || e.ctrlKey) && e.key === "a") {
      e.preventDefault();
      e.stopPropagation();
      onSelectAll?.();
      return;
    }

    if ((e.key === "s" || e.key === "S") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
      onToggleScope?.();
      return;
    }

    // Q: quote the current text selection into the card's slip note (#968).
    // Global layer, not grid layer: after a drag-selection focus usually sits
    // on the body, never inside the grid.
    if ((e.key === "q" || e.key === "Q") && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (onQuoteSelection?.()) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    // Escape: clear selection (globally, regardless of focus)
    // Connections-mode Escape stays on the grid-level handler
    if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) {
      if (!connectionsActive && onClearSelection) {
        e.preventDefault();
        e.stopPropagation();
        onClearSelection();
        return;
      }
    }
  }, [onUndo, onRedo, onSelectAll, onClearSelection, onToggleScope, onQuoteSelection, connectionsActive]);

  useEffect(() => {
    window.addEventListener("keydown", globalHandler, true);
    return () => window.removeEventListener("keydown", globalHandler, true);
  }, [globalHandler]);

  // Grid layer: arrow navigation, Enter, L, P, N, C, ?, Escape
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const grid = gridRef.current;
    if (!grid) return;

    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT" || (document.activeElement as HTMLElement)?.isContentEditable) return;

    if (e.key === "Escape") {
      if (connectionsActive) {
        e.preventDefault();
        onExitConnections?.();
        return;
      }
      // Selection clearing is handled by the global handler
      return;
    }

    const cards = Array.from(grid.querySelectorAll<HTMLElement>("[data-testid='cardbox-card']"));
    const focused = document.activeElement as HTMLElement;
    const currentIndex = cards.indexOf(focused?.closest("[data-testid='cardbox-card']") as HTMLElement);
    if (currentIndex === -1) return;

    const cols = getColumnCount();
    let nextIndex = -1;

    switch (e.key) {
      case "ArrowRight":
        nextIndex = currentIndex + 1 < itemCount ? currentIndex + 1 : 0;
        break;
      case "ArrowLeft":
        nextIndex = currentIndex - 1 >= 0 ? currentIndex - 1 : itemCount - 1;
        break;
      case "ArrowDown":
        nextIndex = currentIndex + cols < itemCount ? currentIndex + cols : currentIndex;
        break;
      case "ArrowUp":
        nextIndex = currentIndex - cols >= 0 ? currentIndex - cols : currentIndex;
        break;
      case "Enter":
        if (e.metaKey || e.ctrlKey) {
          e.preventDefault();
          onNavigate(currentIndex);
        } else {
          e.preventDefault();
          onExpand(currentIndex);
        }
        return;
      case "l":
      case "L":
        if (expandedUuid && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onOpenLinkPicker?.();
        }
        return;
      case "p":
      case "P":
        if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onTogglePin?.(currentIndex);
        }
        return;
      case "n":
      case "N":
        if (expandedUuid && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onToggleNote?.();
        }
        return;
      case "c":
      case "C":
        if (expandedUuid && !e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onShowConnections?.();
        }
        return;
      case "?":
        if (!e.metaKey && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
          onShowShortcuts?.();
        }
        return;
      default:
        return;
    }

    if (nextIndex >= 0 && nextIndex < itemCount) {
      e.preventDefault();
      cards[nextIndex]?.focus();
    }
  }, [getColumnCount, itemCount, onExpand, onNavigate, onOpenLinkPicker, onTogglePin, onToggleNote, onShowConnections, onExitConnections, onShowShortcuts, expandedUuid, connectionsActive]);

  return { gridRef, handleKeyDown };
}
