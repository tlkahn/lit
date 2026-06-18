import { useCallback } from "react";
import { useCardboxSelectionStore } from "../stores/cardboxSelection";

export function useCardboxSelection() {
  const selectedUuids = useCardboxSelectionStore((s) => s.selectedUuids);
  const toggleSelect = useCardboxSelectionStore((s) => s.toggleSelect);
  const rangeSelect = useCardboxSelectionStore((s) => s.rangeSelect);
  const selectAll = useCardboxSelectionStore((s) => s.selectAll);
  const clearSelection = useCardboxSelectionStore((s) => s.clearSelection);

  const selectedCount = selectedUuids.size;

  const handleCardClick = useCallback(
    (uuid: string, event: React.MouseEvent | MouseEvent, orderedUuids: string[]) => {
      if (event.metaKey || event.ctrlKey) {
        toggleSelect(uuid);
        return true; // consumed
      }
      if (event.shiftKey) {
        rangeSelect(uuid, orderedUuids);
        return true; // consumed
      }
      return false; // not a selection click -- let default behavior proceed
    },
    [toggleSelect, rangeSelect],
  );

  return { selectedUuids, selectedCount, handleCardClick, selectAll, clearSelection };
}
