import { useCallback } from "react";
import { getCurrentEditorView } from "../lib/editorViewRef";
import { globalJumpTracker } from "../editor/jumpTracker";

export function useRecordDeparture(pageIdRef: { current: string }): () => void {
  return useCallback(() => {
    const view = getCurrentEditorView();
    const notePath = pageIdRef.current;
    if (!view || !notePath) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    globalJumpTracker.recordJump(
      { notePath, line: line.number, col: head - line.from },
      { notePath: "", line: 0, col: 0 },
    );
  }, []);
}
