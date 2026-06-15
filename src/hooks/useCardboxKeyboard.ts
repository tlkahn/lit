import { useCallback, useRef } from "react";

interface UseCardboxKeyboardOptions {
  onExpand: (index: number) => void;
  onNavigate: (index: number) => void;
  itemCount: number;
}

export function useCardboxKeyboard({ onExpand, onNavigate, itemCount }: UseCardboxKeyboardOptions) {
  const gridRef = useRef<HTMLDivElement>(null);

  const getColumnCount = useCallback(() => {
    const grid = gridRef.current;
    if (!grid || !grid.firstElementChild) return 1;
    const gridWidth = grid.clientWidth;
    // Each column is minmax(280px, 1fr) with 16px gap
    return Math.max(1, Math.floor((gridWidth + 16) / (280 + 16)));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const grid = gridRef.current;
    if (!grid) return;

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
      default:
        return;
    }

    if (nextIndex >= 0 && nextIndex < itemCount) {
      e.preventDefault();
      cards[nextIndex]?.focus();
    }
  }, [getColumnCount, itemCount, onExpand, onNavigate]);

  return { gridRef, handleKeyDown };
}
