import { useCallback } from "react";

/**
 * Returns a click-capture handler that intercepts modifier-key clicks
 * (Cmd/Ctrl/Shift) and forwards them to `onSelect`, preventing the event
 * from reaching the card's inner click handlers.
 *
 * Shared between CardboxCardItem and CardboxGroupCardItem to avoid duplication.
 */
export function useSelectionClickCapture(
  uuid: string,
  onSelect: ((uuid: string, event: React.MouseEvent) => void) | undefined,
) {
  return useCallback(
    (e: React.MouseEvent) => {
      if ((e.metaKey || e.ctrlKey || e.shiftKey) && onSelect) {
        e.stopPropagation();
        onSelect(uuid, e);
      }
    },
    [uuid, onSelect],
  );
}
