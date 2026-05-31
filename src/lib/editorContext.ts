import { getCurrentEditorView } from "./editorViewRef";
import { useWorkspaceStore } from "../stores/workspace";
import { DEFAULT_EDITOR_CONTEXT, type EditorContext } from "../types";

export function requestEditorContext(): EditorContext {
  const view = getCurrentEditorView();
  if (!view) return { ...DEFAULT_EDITOR_CONTEXT };
  const sel = view.state.selection.main;
  return {
    selectionText: view.state.sliceDoc(sel.from, sel.to),
    selectionFrom: sel.from,
    selectionTo: sel.to,
    filePath: useWorkspaceStore.getState().currentPagePath ?? "",
  };
}
