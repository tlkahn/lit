import { useCallback } from "react";
import { usePaneStore } from "../stores/panes";
import { setFocusedPane } from "../lib/editorViewRef";

export function usePaneFocus(paneId: string): () => void {
  return useCallback(() => {
    if (usePaneStore.getState().focusedPaneId === paneId) return;
    usePaneStore.getState().focusPane(paneId);
    setFocusedPane(paneId);
  }, [paneId]);
}
