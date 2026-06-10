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

export function isEditorFocused(): boolean {
  return getCurrentEditorView() != null && isFocusInsideContentPane();
}

export function isFocusInsideContentPane(): boolean {
  const active = document.activeElement;
  if (active == null || active === document.body) {
    return false;
  }

  for (const view of paneViews.values()) {
    if (view.dom.contains(active)) {
      return true;
    }
  }

  if (
    active.closest('[data-pane-id]') != null
  ) {
    return true;
  }

  return false;
}

export function _resetForTesting(): void {
  paneViews.clear();
  focusedPaneId = null;
  legacyView = null;
}
