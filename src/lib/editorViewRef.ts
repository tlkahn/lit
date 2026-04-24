import type { EditorView } from "@codemirror/view";

let currentView: EditorView | null = null;

export function setCurrentEditorView(view: EditorView | null): void {
  currentView = view;
}

export function getCurrentEditorView(): EditorView | null {
  return currentView;
}
