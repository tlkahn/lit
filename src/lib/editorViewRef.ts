import type { EditorView } from "@codemirror/view";

const paneViews = new Map<string, EditorView>();
let focusedPaneId: string | null = null;
let legacyView: EditorView | null = null;

export function registerPaneView(paneId: string, view: EditorView): void {
  paneViews.set(paneId, view);
}

export function unregisterPaneView(paneId: string): void {
  paneViews.delete(paneId);
}

export function getPaneView(paneId: string): EditorView | null {
  return paneViews.get(paneId) ?? null;
}

export function setFocusedPane(paneId: string | null): void {
  focusedPaneId = paneId;
}

export function setCurrentEditorView(view: EditorView | null): void {
  legacyView = view;
}

export function getCurrentEditorView(): EditorView | null {
  if (focusedPaneId !== null) {
    const view = paneViews.get(focusedPaneId);
    if (view) return view;
  }
  return legacyView;
}

export function _resetForTesting(): void {
  paneViews.clear();
  focusedPaneId = null;
  legacyView = null;
}
